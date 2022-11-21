#!/usr/bin/env node
import 'reflect-metadata';
import 'source-map-support/register';
import * as prom from 'prom-client';
import * as util from 'util';

import { logger } from '../app/helpers/pino';
import * as admin from '../app/services/admin';
import * as db from '../app/helpers/db';
import * as network from '../app/services/network';
import * as redis from '../app/helpers/redis';

import { app } from '../app';

import { appPort } from '../config';

import { createApolloServer, ApolloServer } from '../graphql';

let apolloServer: ApolloServer | undefined;

process.on('uncaughtException', (err) => {
  logger.error(err, 'uncaughtException');
});

process.on('uncaughtRejection', (err) => {
  logger.error(err, 'uncaughtRejection');
});

async function shutdown() {
  try {
    await admin.stop();

    await apolloServer?.stop();

    await redis.quit();
    await network.close();
    await db.disconnect();
  } catch (err: any) {
    logger.fatal(err);
    process.exit(1);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function main() {
  await db.connect();
  await network.init();

  apolloServer = await createApolloServer(app);

  await apolloServer.start();

  app.register(apolloServer.createHandler());

  await app.listen(appPort, '0.0.0.0');

  logger.info('metaverse app started');

  const getConnections = util.promisify(app.server.getConnections).bind(app.server);

  new prom.Gauge({
    name: 'http_open_connections',
    help: 'Number of open HTTP connections',
    collect: async function() { this.set(await getConnections()); },
  });

  await admin.start();
}

void main();
