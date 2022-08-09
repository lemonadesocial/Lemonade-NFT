import { ApolloClient, HttpLink, InMemoryCache, NormalizedCacheObject } from '@apollo/client/core';
import * as http from 'http';
import * as https from 'https';
import fetch, { RequestInit } from 'node-fetch';

const agent: Record<string, http.Agent> = {
  'http:': new http.Agent({ keepAlive: true }),
  'https:': new https.Agent({ keepAlive: true }),
};
const fetchOptions: RequestInit = {
  agent: (url) => agent[url.protocol],
  timeout: 10000,
};

const cache = new InMemoryCache();

export type Indexer = ApolloClient<NormalizedCacheObject>;

export function createIndexer(indexerUrl: string): Indexer {
  return new ApolloClient({
    cache,
    defaultOptions: {
      query: { fetchPolicy: 'no-cache' },
    },
    link: new HttpLink({
      fetch,
      fetchOptions,
      uri: indexerUrl,
    }),
  });
}
