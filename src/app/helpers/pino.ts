import { pino } from 'pino';

import { slackWebhookUrl } from '../../config';

const targets: pino.TransportTargetOptions[] = [
  { level: 'trace', target: 'pino/file', options: { destination: 1 } },
  { level: 'fatal', target: 'pino/file', options: { destination: 2 } },
];

export const logger = pino(
  { level: 'trace' },
  pino.transport({ targets })
);

if (slackWebhookUrl) {
  const options = {
    channelKey: 'channel',
    excludedKeys: { channel: 0, imageUrl: 0 },
    imageUrlKey: 'imageUrl',
    keepAlive: true,
    webhookUrl: slackWebhookUrl,
  };

  targets.push({ level: 'info', target: '../../../lib/logger.mjs', options });
}

export const slackLogger = pino(
  { level: 'trace' },
  pino.transport({ targets })
);
