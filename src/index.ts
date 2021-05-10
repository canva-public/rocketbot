import type {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
  Callback,
  Context,
} from 'aws-lambda';
import type {
  PingEvent,
  PullRequest,
  PullRequestEvent,
  Schema,
  WebhookEventMap,
  WebhookEventName,
} from '@octokit/webhooks-types';
import { isTriggerComment, parseTriggerComment } from './trigger';
import { ok } from 'assert';
import type { Logger } from 'pino';
import type { PinoLambdaLogger } from 'pino-lambda';
import pino from 'pino-lambda';
import { Config, getConfig } from './config';
import { buildkiteReadPipelines, buildkiteStartBuild } from './buildkite';
import { zip } from './zip';
import { getOctokit, isOctokitRequestError } from './octokit';
import { fetchDocumentationLinkMds } from './initial_comment';
import { urlPart } from './url_part';
import {
  githubAddComment,
  isIssueComment,
  githubGetPullRequestDetails,
  githubUpdateComment,
} from './github';
import type { Octokit, RestEndpointMethodTypes } from '@octokit/rest';

type PullRequestData = RestEndpointMethodTypes['pulls']['get']['response']['data'];
type UserData = RestEndpointMethodTypes['users']['getByUsername']['response']['data'];

export type JSONResponse =
  | { error: string }
  | ({ success: boolean; triggered: boolean; commented?: boolean } & (
      | { commentUrl?: string }
      | { updatedCommentUrl: string }
      | { message: string }
    ));

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

      if (eventBody.action === 'deleted') {
        logger.info('Comment was deleted, nothing to do here');
        return done(null, { success: true, triggered: false }, callback);
      }
      if (
        isIssueComment(currentEventType, eventBody) &&
        !eventBody.issue.pull_request
      ) {
        logger.info(
          'Request is not coming from a pull request, nothing to do here',
        );
        return done(null, { success: true, triggered: false }, callback);
      }
      if (!isTriggerComment(eventBody.comment.body)) {
        logger.info('Not a comment to trigger a build run, nothing to do here');
        return done(null, { success: true, triggered: false }, callback);
      }

      const prHtmlUrl = isIssueComment(currentEventType, eventBody)
        ? eventBody.issue.pull_request?.html_url
        : eventBody.pull_request.html_url;

      const requestedBuildData = parseTriggerComment(eventBody.comment.body);
      const commentUrl = eventBody.comment.url;
      const commenter = eventBody.sender.login;
      logger.info(
        `@${commenter} requested "${requestedBuildData.buildNames.join(
          ',',
        )}" for ${prHtmlUrl || 'unkown URL'}`, // TODO: better fallback for unkown URLs
      );

      const customEnv = requestedBuildData.env;
      const customEnvKeys = Object.keys(requestedBuildData.env);
      const hasCustomEnv = customEnvKeys.length > 0;
      requestedBuildData.env = customEnvKeys.reduce<NodeJS.ProcessEnv>(
        (ret, key) => {
          ret[`GH_CONTROL_USER_ENV_${key}`] = requestedBuildData.env[key];
          return ret;
        },
        {},
      );

      return Promise.all<PullRequestData | PullRequest, UserData>([
        isIssueComment(currentEventType, eventBody)
          ? githubGetPullRequestDetails(
              octokit,
              eventBody.repository,
              eventBody.issue.number,
            )
          : Promise.resolve(eventBody.pull_request as PullRequest),
        (
          await octokit.users.getByUsername({
            username: eventBody.sender.login,
          })
        ).data,
      ])
        .then(([prData, { name: senderName, email: senderEmail }]) => {
          return buildkiteStartBuild(
            logger,
            config,
            requestedBuildData,
            prData,
            commenter,
            commentUrl,
            senderName,
            senderEmail ?? undefined,
          )
            .then((bkDatas) =>
              bkDatas.map((bkData) => {
                const buildKiteWebUrl = bkData.web_url;
                logger.info('Started Buildkite build %s', buildKiteWebUrl);
                return {
                  url: buildKiteWebUrl,
                  number: bkData.number,
                  scheduled: bkData.scheduled_at,
                };
              }),
            )
            .then((data) => {
              const envParagraph = hasCustomEnv
                ? `\n\nwith user-defined environment variables:\n\`\`\`ini\n${Object.keys(
                    requestedBuildData.env,
                  )
                    .map((k) => `${k}=${requestedBuildData.env[k]}`)
                    .join('\n')}\n\`\`\``
                : '';
              const repeatEnvParagraph = hasCustomEnv
                ? `\n\n\`\`\`ini\n${customEnvKeys
                    .map((k) => `${k}=${customEnv[k]}`)
                    .join('\n')}\n\`\`\``
                : '';
              const repeatParagraph = `
<details>
<summary>Repeat this build</summary>

\`\`\`\`md
${requestedBuildData.buildNames
  .map((buildName) => `:rocket:[${buildName}]`)
  .join('\n')}${repeatEnvParagraph}
\`\`\`\`
</details>
`;
              const perBuildResponse = (buildName: string, idx: number) =>
                `* [${buildName}#${data[idx].number}](${data[idx].url}) scheduled at \`${data[idx].scheduled}\``;
              const updatedComment = `pls gib green ༼ つ ◕_◕ ༽つ via ${
                prData.head.sha
              }:
${requestedBuildData.buildNames
  .map(perBuildResponse)
  .join('\n')}${envParagraph}${repeatParagraph}`;
              return githubUpdateComment(
                octokit,
                currentEventType,
                eventBody.repository,
                eventBody.comment.id,
                updatedComment,
              );
            })
            .then((commentData) => {
              logger.info(
                `Updated comment ${commentData.html_url} with build URL`,
              );
              return commentData.html_url;
            });
        })
        .then(
          (updatedCommentUrl) =>
            done(
              null,
              {
                success: true,
                triggered: true,
                commented: false,
                updatedCommentUrl,
              },
              callback,
            ),
          (err) => done(err, undefined, callback),
        );
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

function ping(event: PingEvent): JSONResponse {
  if (
    !event.hook.active ||
    !event.hook.events ||
    !event.hook.events.includes('issue_comment')
  ) {
    throw new Error('Configure at least the delivery of issue comments');
  }
  const repository = event.repository?.full_name ?? 'unknown repository';

  return {
    success: true,
    triggered: false,
    commented: false,
    message: `Hooks working for ${repository}`,
  };
}

async function prOpened(
  eventBody: PullRequestEvent,
  logger: Logger,
  config: Config,
  octokit: Octokit,
): Promise<JSONResponse> {
  if (eventBody.action !== 'opened') {
    logger.info('PR was not opened, nothing to do here');
    return { success: true, triggered: false };
  }
  const repoSshUrl = eventBody.repository.ssh_url;

  logger.info('PR was opened');
  const pipelineData = await buildkiteReadPipelines(logger, config);

  const validPipelines = pipelineData
    // is enabled for branch builds
    .filter(
      (pipeline) => 'GH_CONTROL_IS_VALID_BRANCH_BUILD' in (pipeline.env || {}),
    )
    // corresponds to the pull request repo
    .filter((pipeline) => urlPart(pipeline.repository) === urlPart(repoSshUrl));

  if (!validPipelines.length) {
    logger.info(
      'No matching/enabled pipelines for this repository, nothing to do here',
    );
    return {
      success: true,
      triggered: false,
      commented: false,
    };
  }

  const linkMds = await fetchDocumentationLinkMds(
    octokit,
    logger,
    eventBody.repository,
    eventBody.pull_request,
    config.BUILDKITE_ORG_NAME,
    validPipelines,
  );

  const pipelines = zip(validPipelines, linkMds)
    .map(([pipeline, linkMd]) => [
      pipeline.slug,
      (pipeline.description || '').trim(),
      linkMd,
    ])
    .sort((a, b) => {
      if (a[0] < b[0]) {
        return -1;
      }
      if (a[0] > b[0]) {
        return 1;
      }
      return 0;
    });

  const pipelineList = pipelines
    .map(
      (row) =>
        `| \`:rocket:[${row[0]}]\` | ${row[1].replace(/\|/g, '\\|')} | ${
          row[2]
        } |`,
    )
    .join('\n');
  const commentData = await githubAddComment(
    octokit,
    logger,
    eventBody.repository,
    eventBody.pull_request,
    `
:tada: Almost merged!
<details>
<summary>Request a branch build</summary>

By commenting on this PR with: \`:rocket:[<pipeline>]\`, e.g.

| Comment | Description | More info |
| --- | --- | --- |
${pipelineList}

_Note: you can pass [custom environment variables](https://github.com/some-org/some-repo/blob/master/tools/github-control/#passing-custom-environment-variables) to some builds._

> Pro-Tip: It is also possible to run multiple builds at once, like this: \`:rocket:[<pipeline-1>][...][<pipeline-n>]\`
</details>`,
  );

  logger.info(
    `Left a comment ${commentData.html_url} on how to start branch builds on ${eventBody.pull_request.html_url}`,
  );
  return {
    success: true,
    triggered: false,
    commented: true,
    commentUrl: commentData.html_url,
  };
}
