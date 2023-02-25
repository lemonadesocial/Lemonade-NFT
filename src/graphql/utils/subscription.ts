import type { GraphQLResolveInfo } from 'graphql';

import { pubSub, Trigger } from '../../app/helpers/pub-sub';

const RETURN_SYMBOL = Symbol('return');

interface State {
  return?: (reason?: unknown) => void;
  returned?: Promise<never>;
}

interface Context<TSource, TArgs, TContext> {
  source: TSource,
  args: TArgs;
  context: TContext;
  info: GraphQLResolveInfo;
}

interface Options<TPayload, TSource, TArgs, TContext> {
  init?: (params: Context<TSource, TArgs, TContext>) => AsyncIterator<TPayload[]>;
  restrict?: (params: Context<TSource, TArgs, TContext>) => ((payload: TPayload) => string) | null;
  trigger: Trigger,
  filter?: (payload: TPayload, params: Context<TSource, TArgs, TContext>) => boolean;
}

export function createSubscribe<TPayload, TSource = unknown, TArgs = unknown, TContext = unknown>({
  init,
  restrict,
  trigger,
  filter,
}: Options<TPayload, TSource, TArgs, TContext>): (source: TSource, args: TArgs, context: TContext, info: GraphQLResolveInfo) => AsyncIterator<TPayload[]> {
  async function* generate(
    ctx: Context<TSource, TArgs, TContext>,
    state: State,
  ) {
    const restrictKey = restrict?.(ctx);
    const restrictions = new Set();

    if (init) {
      for await (const payloads of { [Symbol.asyncIterator]: () => init(ctx) }) {
        if (restrictKey) payloads.forEach((payload) => restrictions.add(restrictKey(payload)));

        yield payloads;
      }
    }

    const iterator = pubSub.asyncIterator<TPayload>(trigger);

    try {
      state.returned = new Promise<never>((_, reject) => state.return = reject);

      for await (const payload of { [Symbol.asyncIterator]: () => ({ ...iterator, next: () => Promise.race([state.returned, iterator.next()]) }) }) {
        if (restrictKey && !restrictions.size) restrictions.add(restrictKey(payload));

        if (restrictKey && !restrictions.has(restrictKey(payload))) continue;

        if (filter && !filter(payload, ctx)) continue;

        yield [payload];
      }
    } catch (reason) {
      if (reason !== RETURN_SYMBOL) throw reason;
    } finally {
      if (iterator.return) await iterator.return();
    }
  }

  return (source: TSource, args: TArgs, context: TContext, info: GraphQLResolveInfo) => {
    const state: State = {};

    const iterator = generate({ source, args, context, info }, state);
    const iteratorReturn = iterator.return.bind(iterator);

    iterator.return = () => {
      state.return?.(RETURN_SYMBOL);

      return iteratorReturn();
    };

    return iterator;
  };
}
