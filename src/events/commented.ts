import {
  IssueCommentEvent,
  PullRequest,
  PullRequestReviewCommentEvent,
  Repository,
} from '@octokit/webhooks-types';
import { isTriggerComment, parseTriggerComment, hasPreamble } from '../trigger';
import { Logger } from 'pino';
import { Config } from '../config';
import { buildkiteStartBuild } from '../buildkite';
import {
  isIssueComment,
  githubGetPullRequestDetails,
  githubAddComment,
  githubUpdateComment,
} from '../github';
import type { RestEndpointMethodTypes } from '@octokit/rest';
import type { JSONResponse } from '../response';
import { GithubApis } from '../github_apis';
import { IssueComment, Mutation, Scalars, User } from '@octokit/graphql-schema';

export type PullRequestData = RestEndpointMethodTypes['pulls']['get']['response']['data'];
export type UserData = RestEndpointMethodTypes['users']['getByUsername']['response']['data'];

type PullRequestContext = PullRequestData | PullRequest;
type Unpromisify<T> = T extends Promise<infer U> ? U : T;
type ID = Scalars['ID'];

export type CommentsRequestData = {
  self: Pick<User, 'login'>;
  comments: {
    pullRequest: {
      comments: {
        nodes: (Pick<IssueComment, 'viewerDidAuthor' | 'id' | 'isMinimized'> & {
          editor?: Pick<User, 'login'>;
        })[];
      };
    };
  };
};

const envVarPrefix = 'GH_CONTROL_USER_ENV_';
const BOT_SUFFIX = '[bot]';

export async function commented(
  eventBody: IssueCommentEvent | PullRequestReviewCommentEvent,
  currentEventType: 'issue_comment' | 'pull_request_review_comment',
  logger: Logger,
  config: Config,
  apis: GithubApis,
): Promise<JSONResponse> {
  const { octokit } = apis;
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
    if (hasPreamble(eventBody.comment.body)) {
      const commentData = await githubAddComment(
        octokit,
        logger,
        eventBody.repository,
        isIssueComment(currentEventType, eventBody)
          ? eventBody.issue.number
          : eventBody.pull_request.number,
        "Your last comment looked similar to a command but Rocketbot couldn't understand it. Were you trying to [run a build](https://github.com/canva-public/rocketbot/blob/main/docs/getting-started.md#run-a-build)?",
      );
      logger.info(
        'Contains preamble but did not qualify as a trigger. Warned the user',
      );
      return {
        success: true,
        triggered: false,
        commented: true,
        commentUrl: commentData.html_url,
      };
    } else {
      logger.info('Not a comment to trigger a build run, nothing to do here');
      return { success: true, triggered: false };
    }
  }

  const pr = isIssueComment(currentEventType, eventBody)
    ? // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      eventBody.issue.pull_request! // we know it came from a PR, otherwise we'd have exited above
    : eventBody.pull_request;
  const requestedBuildData = parseTriggerComment(eventBody.comment.body);
  const commentUrl = eventBody.comment.url;
  const commenter = eventBody.sender.login;
  logger.info(
    `@${commenter} requested "${requestedBuildData.buildNames.join(',')}" for ${
      pr.html_url
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
    PullRequestContext,
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
  if (config.COLLAPSE_OLD_COMMENTS === 'true') {
    await collapseOldComments(
      apis,
      prData,
      eventBody.repository,
      commentData,
      logger,
    );
  }
  return {
    success: true,
    triggered: true,
    commented: false,
    updatedCommentUrl: commentData.html_url,
  };
}

/**
 * Collapses comments for and from RocketBot prior to the current one
 */
async function collapseOldComments(
  { graphql }: GithubApis,
  prData: PullRequestContext,
  repository: Repository,
  currentComment: Unpromisify<ReturnType<typeof githubUpdateComment>>,
  logger: Logger,
) {
  const res = await graphql<CommentsRequestData>(commentsReq, {
    repoName: repository.name,
    repoOwner: repository.owner.login,
    prNumber: prData.number,
  });

  const currentUser = stripBotSuffix(res.self.login);
  logger.info('current user is "%s"', currentUser);
  const { nodes: comments } = res.comments.pullRequest.comments;
  logger.info('current comment ID is "%s"', currentComment.node_id);

  const toCollapse: ID[] = comments.reduce<ID[]>((acc, comment) => {
    if (comment.isMinimized) {
      // ignore all minimized
      return acc;
    }

    if (comment.id === currentComment.node_id) {
      // ignore the current comment (the one that has triggered this run)
      return acc;
    }

    if (comment.viewerDidAuthor) {
      // author was rocketbot, collapse
      return [...acc, comment.id];
    }
    if (comment.editor?.login === currentUser) {
      // last editor was rocketbot, collapse
      return [...acc, comment.id];
    }
    return acc;
  }, []);

  logger.info('Collapsing comment IDs: %o', toCollapse);

  await Promise.all(
    toCollapse.map((subjectId) =>
      graphql<Pick<Mutation, 'minimizeComment'>>(mutationReq, { subjectId }),
    ),
  );
}

export const commentsReq = `
query($repoName: String!, $repoOwner: String!, $prNumber: Int!) {
  self: viewer {
    login
  }
  comments: repository(name: $repoName, owner: $repoOwner) {
    pullRequest(number: $prNumber) {
      comments(last: 10) {
        nodes {
          id
          viewerDidAuthor
          editor {
            login
          }
          isMinimized
        }
      }
    }
  }
}
`;

export const mutationReq = `
mutation($subjectId: ID!) {
  minimizeComment(
    input: { subjectId: $subjectId, classifier: OUTDATED }
  ) {
    clientMutationId
  }
}
`;

function stripBotSuffix(login: string) {
  return login.endsWith(BOT_SUFFIX)
    ? login.substr(0, login.length - BOT_SUFFIX.length)
    : login;
}
