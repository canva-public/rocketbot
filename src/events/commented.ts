import {
  IssueCommentEvent,
  PullRequest,
  PullRequestReviewCommentEvent,
} from '@octokit/webhooks-types';
import { isTriggerComment, parseTriggerComment } from '../trigger';
import { Logger } from 'pino';
import { Config } from '../config';
import { buildkiteStartBuild } from '../buildkite';
import {
  isIssueComment,
  githubGetPullRequestDetails,
  githubUpdateComment,
} from '../github';
import type { Octokit, RestEndpointMethodTypes } from '@octokit/rest';
import type { JSONResponse } from '../response';

export type PullRequestData = RestEndpointMethodTypes['pulls']['get']['response']['data'];
export type UserData = RestEndpointMethodTypes['users']['getByUsername']['response']['data'];

const envVarPrefix = 'GH_CONTROL_USER_ENV_';

export async function commented(
  eventBody: IssueCommentEvent | PullRequestReviewCommentEvent,
  currentEventType: 'issue_comment' | 'pull_request_review_comment',
  logger: Logger,
  config: Config,
  octokit: Octokit,
): Promise<JSONResponse> {
  if (eventBody.action === 'deleted') {
    logger.info('Comment was deleted, nothing to do here');
    return { success: true, triggered: false };
  }
  if (
    isIssueComment(currentEventType, eventBody) &&
    !eventBody.issue.pull_request
  ) {
    logger.info(
      'Request is not coming from a pull request, nothing to do here',
    );
    return { success: true, triggered: false };
  }
  if (!isTriggerComment(eventBody.comment.body)) {
    logger.info('Not a comment to trigger a build run, nothing to do here');
    return { success: true, triggered: false };
  }

  const prHtmlUrl = isIssueComment(currentEventType, eventBody)
    ? eventBody.issue.pull_request?.html_url
    : eventBody.pull_request.html_url;

  const requestedBuildData = parseTriggerComment(eventBody.comment.body);
  const commentUrl = eventBody.comment.url;
  const commenter = eventBody.sender.login;
  logger.info(
    `@${commenter} requested "${requestedBuildData.buildNames.join(',')}" for ${
      prHtmlUrl || 'unkown URL'
    }`,
  );

  const customEnv = requestedBuildData.env;
  const customEnvKeys = Object.keys(requestedBuildData.env);
  const hasCustomEnv = customEnvKeys.length > 0;
  requestedBuildData.env = customEnvKeys.reduce<NodeJS.ProcessEnv>(
    (ret, key) => {
      ret[`${envVarPrefix}${key}`] = requestedBuildData.env[key];
      return ret;
    },
    {},
  );

  const [prData, { name: senderName, email: senderEmail }] = await Promise.all<
    PullRequestData | PullRequest,
    UserData
  >([
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
  ]);

  const builds = await buildkiteStartBuild(
    logger,
    config,
    requestedBuildData,
    prData,
    commenter,
    commentUrl,
    senderName,
    senderEmail ?? undefined,
  );
  const data = builds.map((build) => {
    logger.info('Started Buildkite build %s', build.web_url);
    return {
      url: build.web_url,
      number: build.number,
      scheduled: build.scheduled_at,
    };
  });

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
  const updatedComment = `pls gib green ༼ つ ◕_◕ ༽つ via ${prData.head.sha}:
${requestedBuildData.buildNames
  .map(perBuildResponse)
  .join('\n')}${envParagraph}${repeatParagraph}`;
  const commentData = await githubUpdateComment(
    octokit,
    currentEventType,
    eventBody.repository,
    eventBody.comment.id,
    updatedComment,
  );
  logger.info(`Updated comment ${commentData.html_url} with build URL`);
  return {
    success: true,
    triggered: true,
    commented: false,
    updatedCommentUrl: commentData.html_url,
  };
}
