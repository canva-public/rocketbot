import type { APIGatewayProxyEvent } from 'aws-lambda';
import { ok } from 'assert';

import { verify } from '@octokit/webhooks-methods';

export function hasValidSignature(
  secret: Parameters<typeof verify>[0],
  event: APIGatewayProxyEvent,
): ReturnType<typeof verify> {
  const signatureHeader =
    event.headers['X-Hub-Signature-256'] ?? event.headers['X-Hub-Signature'];
  ok(
    signatureHeader,
    'No X-Hub-Signature-256 or X-Hub-Signature found on request',
  );
  ok(event.body, 'No event body');
  return verify(secret, event.body, signatureHeader);
}
