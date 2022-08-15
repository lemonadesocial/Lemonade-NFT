import { URL } from 'url';

import { ipfsGatewayUrl, webUrl } from '../../config';

export function parseUrl(input: string) {
  const url = new URL(input);

  if (url.protocol === 'ipfs:') {
    return new URL(`${ipfsGatewayUrl}ipfs/${url.href.substring('ipfs://'.length)}`);
  }

  return url;
}

export function getParsedUrl(input: unknown) {
  if (typeof input !== 'string') return;

  try {
    return parseUrl(input).href;
  } catch { /* no-op */ }
}

export function getWebUrl(args: { network: string; contract: string, tokenId: string }) {
  return `${webUrl}nft/${args.network}/${args.contract}/${args.tokenId}`;
}
