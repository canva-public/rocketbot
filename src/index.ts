import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';
import type {
  WebhookEventMap,
  WebhookEventName,
} from '@octokit/webhooks-types';
import { ok } from 'assert';
import type { PinoLambdaLogger } from 'pino-lambda';
import pino from 'pino-lambda';
import { Config, getConfig } from './config';
import { getGithubApis, isOctokitRequestError } from './github_apis';
import { commented } from './events/commented';
import type { JSONResponse } from './response';
import { ping } from './events/ping';
import { prOpened } from './events/pr_opened';
import { hasValidSignature } from './signature';

const getLogger = (config: Config): PinoLambdaLogger =>
  pino({
    level: 'debug',
    enabled: config.ENABLE_DEBUG !== 'false',
  });

function response(
  err: Error | null,
  res?: JSONResponse,
): APIGatewayProxyResult {
  return {
    statusCode: err ? (isOctokitRequestError(err) ? err.status : 400) : 200,
    body: err ? JSON.stringify({ error: err.message }) : JSON.stringify(res),
    headers: {
      'Content-Type': 'application/json',
    },
  };
}

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  const config = await getConfig(process.env);
  const logger = getLogger(config);
  const apis = await getGithubApis(config, logger);

  logger.withRequest(
    {
      ...event,
      headers: {
        ...(event.headers || {}),
        'x-correlation-github-delivery': event.headers['X-GitHub-Delivery'],
      },
    },
    context,
  );

  logger.debug('Received event: %o', event);

  if (
    typeof config.GITHUB_WEBHOOK_SECRET !== 'undefined' &&
    config.GITHUB_WEBHOOK_SECRET !== ''
  ) {
    logger.info('Verifying request signature');
    const isValidSignature = await hasValidSignature(
      config.GITHUB_WEBHOOK_SECRET,
      event,
    );
    if (!isValidSignature) {
      logger.warn('Request signature invalid');
      return response(new Error('Invalid signature'));
    }
    logger.debug('Signature valid');
  } else {
    logger.debug(
      'Signature verification is not enabled. This is not recommended.',
    );
  }

  if (event.httpMethod !== 'POST') {
    return response(new Error(`Unsupported method "${event.httpMethod}"`));
  }

  ok(event.headers['X-GitHub-Event']);
  const currentEventType = event.headers['X-GitHub-Event'] as WebhookEventName;

  ok(event.body, 'No event body');
  let body: unknown;
  try {
    body = JSON.parse(event.body);
    ok(body && typeof body === 'object', 'Event body is empty');
  } catch (e) {
    return response(new Error(`Could not parse event body: ${e.message}`));
  }

  try {
    switch (currentEventType) {
      case 'pull_request': {
        return response(
          null,
          await prOpened(
            body as WebhookEventMap[typeof currentEventType],
            logger,
            config,
            apis,
          ),
        );
      }
      case 'issue_comment':
      case 'pull_request_review_comment': {
        return response(
          null,
          await commented(
            body as WebhookEventMap[typeof currentEventType],
            currentEventType,
            logger,
            config,
            apis,
          ),
        );
      }
      case 'ping': {
        return response(
          null,
          ping(body as WebhookEventMap[typeof currentEventType]),
        );
      }
      default:
        throw new Error(`Unsupported event type "${currentEventType}"`);
    }
  } catch (e) {
    return response(e);
  }
};
