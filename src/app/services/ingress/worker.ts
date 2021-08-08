import { BulkWriteOperation } from 'mongodb';
import { Counter, Histogram } from 'prom-client';
import { JobsOptions, Processor, Queue, QueueScheduler, Worker } from 'bullmq';
import Redis from 'ioredis';

import { excludeNull } from '../../utils/object';
import { logger } from '../../helpers/pino';
import { pubSub } from '../../helpers/pub-sub';
import * as enrich from '../enrich/queue';
import * as indexer from '../../helpers/indexer';
import * as web3 from '../../helpers/web3';

import { Order, OrderKind, OrderModel } from '../../models/order';
import { StateModel } from '../../models/state';
import { Token, TokenModel } from '../../models/token';

import { GetOrders } from '../../../lib/lemonade-marketplace/documents.generated';
import { GetOrdersQuery, GetOrdersQueryVariables } from '../../../lib/lemonade-marketplace/types.generated';

import { redisUri } from '../../../config';

type GetOrdersOrder = GetOrdersQuery['orders'] extends (infer T)[] ? T : never;

const POLL_FIRST = 1000;
const QUEUE_NAME = 'bullmq:ingress';

const ingressesTotal = new Counter({
  labelNames: ['status'],
  name: 'metaverse_ingresses_total',
  help: 'Total number of metaverse ingresses',
});
const ingressDurationSeconds = new Histogram({
  name: 'metaverse_ingress_duration_seconds',
  help: 'Duration of metaverse ingress in seconds',
});

const jobOptions: JobsOptions = {
  attempts: Number.MAX_VALUE,
  backoff: 2000,
  delay: 1000,
  removeOnComplete: true,
  removeOnFail: true,
};
const stateQuery = { key: 'ingress_last_block' };

const buildOrder = ({ createdAt, kind, openFrom, openTo, token, ...order }: GetOrdersOrder): Order => {
  return {
    createdAt: new Date(parseInt(createdAt) * 1000),
    kind: kind as string as OrderKind,
    openFrom: openFrom ? new Date(parseInt(openFrom) * 1000) : undefined,
    openTo: openTo ? new Date(parseInt(openTo) * 1000) : undefined,
    token: token.id,
    ...excludeNull(order),
  };
};

const buildToken = ({ token: { createdAt, ...token } }: GetOrdersOrder): Token => {
  return {
    createdAt: createdAt ? new Date(parseInt(createdAt) * 1000) : undefined,
    ...excludeNull(token),
  };
};

const process = async (dataOrders: GetOrdersOrder[]) => {
  const orders = dataOrders.map(buildOrder);
  const tokens = dataOrders.map(buildToken);

  const [_, { upsertedIds = {} }] = await Promise.all([
    OrderModel.bulkWrite(
      orders.map<BulkWriteOperation<Order>>(({ id, ...order }) => ({
        updateOne: {
          filter: { id },
          update: { $set: order },
          upsert: true,
        },
      })),
      { ordered: false },
    ),
    TokenModel.bulkWrite(
      tokens.map<BulkWriteOperation<Token>>(({ id, ...token }) => ({
        updateOne: {
          filter: { id },
          update: { $set: token },
          upsert: true,
        },
      })),
      { ordered: false },
    ),
  ]);

  const promises: Promise<unknown>[] = [];
  const upsertedIdxs = Object.keys(upsertedIds).map((key) => parseInt(key));

  if (upsertedIdxs.length) {
    promises.push(
      enrich.enqueue(...upsertedIdxs.map((i) => ({
        order: orders[i],
        token: tokens[i],
      })))
    );
  }

  for (const i of dataOrders.keys()) {
    logger.info({ order: orders[i], token: tokens[i] }, 'ingress');

    if (i in upsertedIdxs) continue;

    promises.push(
      pubSub.publish('order_updated', { ...orders[i], token: tokens[i] })
    );
  }

  await Promise.all(promises);
};

const poll = async (lastBlock_gt?: string) => {
  let skip = 0;
  const first = POLL_FIRST;

  let lastBlock: string | undefined;
  let length = 0;
  do {
    const { data } = await indexer.client.query<GetOrdersQuery, GetOrdersQueryVariables>({
      query: GetOrders,
      variables: { lastBlock_gt, skip, first },
      fetchPolicy: 'no-cache',
    });

    length = data?.orders?.length || 0;
    logger.debug({ lastBlock_gt, skip, first, length });

    if (length) {
      await process(data.orders);

      skip += first;
      lastBlock = data.orders[length - 1].lastBlock; // requires asc sort on lastBlock
    }
  } while (length);

  return lastBlock;
};

interface JobData {
  lastBlock_gt?: string;
}

let queue: Queue | undefined;
let queueScheduler: QueueScheduler | undefined;
let worker: Worker<JobData> | undefined;

const processor: Processor<JobData> = async ({ data: { lastBlock_gt } }) => {
  const stopTimer = ingressDurationSeconds.startTimer();

  try {
    const lastBlock = await poll(lastBlock_gt);

    await Promise.all([
      lastBlock && lastBlock !== lastBlock_gt
        ? StateModel.updateOne(stateQuery, { $set: { value: lastBlock } }, { upsert: true })
        : null,
      queue!.add('*', { lastBlock_gt: lastBlock || lastBlock_gt }, jobOptions),
    ]);

    ingressesTotal.labels('success').inc();

    stopTimer();
  } catch (err) {
    ingressesTotal.labels('fail').inc();

    throw err;
  }
};

export const start = async (): Promise<void> => {
  queue = new Queue<JobData>(QUEUE_NAME, { connection: new Redis(redisUri) });
  queueScheduler = new QueueScheduler(QUEUE_NAME, { connection: new Redis(redisUri) });
  await Promise.all([
    enrich.waitUntilReady(),
    queue.waitUntilReady(),
    queueScheduler.waitUntilReady(),
  ]);

  if (!await queue.count()) {
    const state = await StateModel.findOne(stateQuery, { value: 1 }, { lean: true });
    const job = await queue.add('*', { lastBlock_gt: state?.value }, jobOptions);
    logger.info(job.asJSON(), 'created ingress job');
  }

  worker = new Worker<JobData>(QUEUE_NAME, processor, { connection: new Redis(redisUri) });
  worker.on('failed', function onFailed(_, error) {
    logger.error(error, 'failed to ingress');
  });
  await worker.waitUntilReady();
};

export const stop = async (): Promise<void> => {
  if (worker) await worker.close();
  indexer.stop();
  web3.disconnect();

  await enrich.close();
  if (queue) await queue.close();
  if (queueScheduler) await queueScheduler.close();
};
