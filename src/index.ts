import type {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
  Callback,
  Context,
} from 'aws-lambda';
import type {
  Schema,
  WebhookEventMap,
  WebhookEventName,
} from '@octokit/webhooks-types';
import { ok } from 'assert';
import type { PinoLambdaLogger } from 'pino-lambda';
import pino from 'pino-lambda';
import { Config, getConfig } from './config';
import { getOctokit, isOctokitRequestError } from './octokit';
import { commented } from './events/commented';
import type { JSONResponse } from './response';
import { ping } from './events/ping';
import { prOpened } from './events/pr_opened';

const getLogger = (config: Config): PinoLambdaLogger =>
  pino({
    level: 'debug',
    enabled: config.ENABLE_DEBUG !== 'false',
  });

const done = (err: Error | null, res?: JSONResponse, callback?: Callback) => {
  const ret: APIGatewayProxyResult = {
    statusCode: err ? (isOctokitRequestError(err) ? err.status : 400) : 200,
    body: err ? JSON.stringify({ error: err.message }) : JSON.stringify(res),
    headers: {
      'Content-Type': 'application/json',
    },
  };
  callback?.(null, ret);
  return Promise.resolve(ret);
};

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
  context: Context /* For legacy testing only */,
  callback?: Callback /* For legacy testing only */,
): Promise<APIGatewayProxyResult> => {
  const config = await getConfig(process.env);
  const logger = getLogger(config);
  const octokit = await getOctokit(config, logger);

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

  if (event.httpMethod !== 'POST') {
    return done(
      new Error(`Unsupported method "${event.httpMethod}"`),
      undefined,
      callback,
    );
  }

  ok(event.headers['X-GitHub-Event']);
  const currentEventType = event.headers['X-GitHub-Event'] as WebhookEventName;

  function parseBody<T extends Schema>(event: APIGatewayProxyEvent) {
    ok(event.body);
    logger.debug('event body: %o', event.body);
    try {
      return (JSON.parse(event.body) as unknown) as T;
    } catch (e) {
      throw new Error(`Could not parse event body: ${e.message}`);
    }
  }

  switch (currentEventType) {
    case 'pull_request': {
      const eventBody = parseBody<WebhookEventMap[typeof currentEventType]>(
        event,
      );
      try {
        return done(
          null,
          await prOpened(eventBody, logger, config, octokit),
          callback,
        );
      } catch (e) {
        return done(e, undefined, callback);
      }
    }
    case 'issue_comment':
    case 'pull_request_review_comment': {
      const eventBody = parseBody<WebhookEventMap[typeof currentEventType]>(
        event,
      );
      try {
        return done(
          null,
          await commented(eventBody, currentEventType, logger, config, octokit),
          callback,
        );
      } catch (e) {
        return done(e, undefined, callback);
      }
    }
    case 'ping': {
      const eventBody = parseBody<WebhookEventMap[typeof currentEventType]>(
        event,
      );
      try {
        return done(null, ping(eventBody), callback);
      } catch (e) {
        return done(e, undefined, callback);
      }
    }
    default:
      return done(
        new Error(`Unsupported event type "${currentEventType}"`),
        undefined,
        callback,
      );
  }
};
