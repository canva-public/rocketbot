import type {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
  Callback,
  Context,
} from 'aws-lambda';
import type {
  IssueComment,
  IssueCommentEvent,
  PullRequest,
  Schema,
  User,
  WebhookEvent,
  WebhookEventMap,
  WebhookEventName,
} from '@octokit/webhooks-types';
import { isTriggerComment, parseTriggerComment } from './trigger';
import type { Endpoints } from '@octokit/types';
import type { IncomingHttpHeaders } from 'http';
import type { RequestOptions } from 'https';
import { ok } from 'assert';
import { parse } from 'url';
import { request } from 'https';
import pino from 'pino-lambda'; // eslint-disable-line sort-imports

type Unarray<T> = T extends Array<infer U> ? U : T;

type Contents = Unarray<
  Endpoints['GET /repos/{owner}/{repo}/contents/{path}']['response']['data']
>;

type Dict<T> = Record<string, T>;

const logger = pino({
  level: 'debug',
  enabled: process.env.ENABLE_DEBUG !== 'false',
});

const log = logger.debug.bind(logger);
const info = logger.info.bind(logger);

log('Loading function');

function assertNotEmpty<T>(thing: T | undefined): T {
  ok(thing);
  return thing;
}

export type JSONResponse =
  | { error: string }
  | ({ success: boolean; triggered: boolean; commented?: boolean } & (
      | { commentUrl?: string }
      | { updatedCommentUrl: string }
      | { message: string }
    ));

// needs: read_builds, write_builds, read_pipelines
const BUILDKITE_TOKEN = assertEnv('BUILDKITE_TOKEN');
const BUILDKITE_ORG_NAME = assertEnv('BUILDKITE_ORG_NAME');
const GITHUB_TOKEN = assertEnv('GITHUB_TOKEN');
const GITHUB_USER = assertEnv('GITHUB_USER');

class HttpError extends Error {
  constructor(message: string) {
    super(message);

    this.name = 'HttpError';
  }
}

class Http404Error extends HttpError {
  constructor(message: string) {
    super(message);

    this.name = 'Http404Error';
  }
}

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
  context: Context /* For legacy testing only */,
  callback?: Callback /* For legacy testing only */,
): Promise<APIGatewayProxyResult> => {
  logger.withRequest(event, context);

  log('Received event:', JSON.stringify(event, null, 2));

  const done = (err: Error | null, res?: JSONResponse) => {
    const ret: APIGatewayProxyResult = {
      statusCode: err ? 400 : 200,
      body: err ? JSON.stringify({ error: err.message }) : JSON.stringify(res),
      headers: {
        'Content-Type': 'application/json',
      },
    };
    callback?.(null, ret);
    return Promise.resolve(ret);
  };

  if (event.httpMethod !== 'POST') {
    return done(new Error(`Unsupported method "${event.httpMethod}"`));
  }

  ok(event.headers['X-GitHub-Event']);
  const currentEventType = (event.headers[
    'X-GitHub-Event'
  ] as unknown) as WebhookEventName;

  function parseBody<T extends Schema>(event: APIGatewayProxyEvent) {
    ok(event.body);
    log('event body', event.body);
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
      if (eventBody.action !== 'opened') {
        info('PR was not opened, nothing to do here');
        return done(null, { success: true, triggered: false });
      }
      const repoSshUrl = eventBody.repository.ssh_url;

      return buildkiteReadPipelines()
        .then((pipelineData) =>
          pipelineData
            // is enabled for branch builds
            .filter(
              (pipeline) =>
                'GH_CONTROL_IS_VALID_BRANCH_BUILD' in (pipeline.env || {}),
            )
            // corresponds to the pull request repo
            .filter(
              (pipeline) =>
                urlPart(pipeline.repository) === urlPart(repoSshUrl),
            ),
        )
        .then((pipelines) =>
          Promise.all([
            pipelines,
            fetchDocumentationLinkMds(
              eventBody.pull_request,
              BUILDKITE_ORG_NAME,
              pipelines,
            ),
          ]),
        )
        .then(([pipelines, linkMds]) =>
          zip(pipelines, linkMds)
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
            }),
        )
        .then(
          (pipelines) => {
            if (!pipelines.length) {
              info(
                'No matching/enabled pipelines for this repository, nothing to do here',
              );
              return done(null, {
                success: true,
                triggered: false,
                commented: false,
              });
            }
            const pipelineList = pipelines
              .map(
                (row) =>
                  `| \`:rocket:[${row[0]}]\` | ${row[1].replace(
                    /\|/g,
                    '\\|',
                  )} | ${row[2]} |`,
              )
              .join('\n');
            return githubAddComment(
              eventBody.pull_request.comments_url,
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
            )
              .then((commentData) => {
                info(
                  `Left a comment ${commentData.html_url} on how to start branch builds on ${eventBody.pull_request.html_url}`,
                );
                return commentData.html_url;
              })
              .then(
                (commentUrl) =>
                  done(null, {
                    success: true,
                    triggered: false,
                    commented: true,
                    commentUrl,
                  }),
                (err) => done(err),
              );
          },
          (err) => done(err),
        );
    }
    case 'issue_comment':
    case 'pull_request_review_comment': {
      const isIssueComment = (
        eventName: WebhookEventName,
        event: WebhookEvent,
      ): event is IssueCommentEvent => eventName === 'issue_comment';
      const eventBody = parseBody<WebhookEventMap[typeof currentEventType]>(
        event,
      );
      const commenter = eventBody.sender.login;

      if (commenter === GITHUB_USER) {
        info('Bot user commented, nothing to do here');
        return done(null, { success: true, triggered: false });
      }

      if (eventBody.action === 'deleted') {
        info('Comment was deleted, nothing to do here');
        return done(null, { success: true, triggered: false });
      }
      if (
        isIssueComment(currentEventType, eventBody) &&
        !eventBody.issue.pull_request
      ) {
        info('Request is not coming from a pull request, nothing to do here');
        return done(null, { success: true, triggered: false });
      }
      if (!isTriggerComment(eventBody.comment.body)) {
        info('Not a comment to trigger a build run, nothing to do here');
        return done(null, { success: true, triggered: false });
      }

      const prHtmlUrl = isIssueComment(currentEventType, eventBody)
        ? eventBody.issue.pull_request?.html_url
        : eventBody.pull_request.html_url;

      const requestedBuildData = parseTriggerComment(eventBody.comment.body);
      const commentUrl = eventBody.comment.url;
      info(
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

      return Promise.all<PullRequest, User>([
        isIssueComment(currentEventType, eventBody)
          ? githubGetPullRequestDetails(
              assertNotEmpty(eventBody.issue.pull_request?.url), // TODO: handle empty case gracefully
            )
          : Promise.resolve(eventBody.pull_request as PullRequest),
        Promise.resolve(eventBody.sender),
      ])
        .then((dataArray) => {
          const prData = dataArray[0];
          const senderData = dataArray[1];
          const senderName = senderData.name;
          const senderEmail = senderData.email ?? undefined;

          return buildkiteStartBuild(
            requestedBuildData,
            prData,
            commenter,
            commentUrl,
            senderName,
            senderEmail,
          )
            .then((bkDatas) =>
              bkDatas.map((bkData) => {
                const buildKiteWebUrl = bkData.web_url;
                info(`Started Buildkite build ${buildKiteWebUrl}`);
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
              return githubUpdateComment(eventBody.comment.url, updatedComment);
            })
            .then((commentData) => {
              info(`Updated comment ${commentData.html_url} with build URL`);
              return commentData.html_url;
            });
        })
        .then(
          (updatedCommentUrl) =>
            done(null, {
              success: true,
              triggered: true,
              commented: false,
              updatedCommentUrl,
            }),
          (err) => done(err),
        );
    }
    case 'ping': {
      const eventBody = parseBody<WebhookEventMap[typeof currentEventType]>(
        event,
      );
      if (
        !eventBody.hook.active ||
        !eventBody.hook.events ||
        eventBody.hook.events.indexOf('issue_comment') === -1
      ) {
        return done(
          new Error('Configure at least the delivery of issue comments'),
        );
      }

      const repository =
        eventBody.repository?.full_name ?? 'unknown repository';

      return done(null, {
        success: true,
        triggered: false,
        commented: false,
        message: `Hooks working for ${repository}`,
      });
    }
    default:
      return done(new Error(`Unsupported event type "${currentEventType}"`));
  }
};

/**
 * Returns the URL component of an SSH URI. That is, it removes everything
 * before the @ sign, if it exists:
 *
 *    user@hostname:path/to/resource  ==> hostname:path/to/resource
 *    ssh://hostname:path/to/resource ==> hostname:path/to/resource
 *
 * @return The URL component of an SSH URI.
 */
function urlPart(sshUri: string) {
  if (!sshUri) {
    throw new Error(`Invalid SSH URI: ${sshUri}`);
  }

  const parts = sshUri.split('@');
  if (parts.length > 2) {
    throw new Error(`Invalid SSH URI; Contains too many @-signs: ${sshUri}`);
  } else {
    return parts.pop();
  }
}

/* Github API helper functions */

/**
 * Retrieves details about a pull request
 */
async function githubGetPullRequestDetails(
  prUrl: string /* The fully qualified API URL to a Github comment */,
) {
  return githubApiRequest<PullRequest>(prUrl);
}

/**
 * Adds a comment to a given comment thread
 *
 * @param commentsUrl The fully qualified API URL to a github comments endpoint.
 * @param commentBody The content to use for the comment. Can contain markdown.
 * @return A promise resolving to the decoded JSON data of the Github API response
 */
async function githubAddComment(commentsUrl: string, commentBody: string) {
  const options = { method: 'POST' };
  const body = { body: commentBody };
  return githubApiRequest<IssueComment>(commentsUrl, options, body);
}

/**
 * Updates a Github comment
 *
 * @param commentUrl The fully qualified API URL to a github comment endpoint.
 * @param newBody The new content to use for the comment. Can contain markdown.
 * @return A promise resolving to the decoded JSON data of the Github API response
 */
async function githubUpdateComment(commentUrl: string, newBody: string) {
  const options = { method: 'PATCH' };
  const body = { body: newBody };
  return githubApiRequest<IssueComment>(commentUrl, options, body);
}

/**
 * Templates a string
 *
 * Variables in the string are given using Bash-like syntax (e.g. $var or
 * ${var}).
 */
function template(
  templateString: string,
  mapping: Dict<string> /* A mapping from a variable name to its value. */,
): string {
  function reducer(haystack: string, mappingEntry: [string, string]) {
    const [varName, replacement] = mappingEntry;
    const needle = new RegExp(
      // eslint-disable-next-line prefer-template, no-multi-spaces, operator-linebreak, no-useless-concat
      '(\\$' + varName + '(?![a-zA-Z0-9]))|' + '(\\${' + varName + '})',
      'g',
    );
    return haystack.replace(needle, replacement);
  }
  return Object.entries(mapping).reduce(reducer, templateString);
}

/**
 * Fetch data to produce markdown linking to documentation a set of pipelines
 *
 * @param prData Data belonging to the PR which this markdown should be produced for.
 * @param orgSlug The Buildkite organization which this markdown should be produced for.
 * @param pipeline An array of pipeline objects.
 * @return A promise resolving to an array of strings.
 */
function fetchDocumentationLinkMds(
  prData: PullRequest,
  orgSlug: string,
  pipelines: Pipeline[],
) {
  return Promise.all(
    pipelines.map((pipeline) =>
      fetchDocumentationLinkMd(prData, BUILDKITE_ORG_NAME, pipeline),
    ),
  );
}

/**
 * Fetch data to produce markdown linking to documentation a single pipeline
 *
 * @param prData Data belonging to the PR which this markdown should be produced for.
 * @param orgSlug The Buildkite organization which this markdown should be produced for.
 * @param pipeline An array of pipeline objects.
 * @return A promise resolving to a string.
 */
async function fetchDocumentationLinkMd(
  prData: PullRequest,
  orgSlug: string,
  pipeline: Pipeline,
) {
  const documentationUrl = await fetchDocumentationUrl(
    prData,
    orgSlug,
    pipeline,
  );
  const documentationCreationLink = getDocumentationCreationLink(
    prData,
    orgSlug,
    pipeline,
  );

  return documentationUrl
    ? `[:information_source:](${documentationUrl} "See more information")`
    : `[:heavy_plus_sign:](${documentationCreationLink} "Add more information")`;
}

/**
 * Fetch the URL linking to documentation for a pipeline
 *
 * @param prData Data belonging to the PR which this markdown should be produced for.
 * @param orgSlug The Buildkite organization which this markdown should be produced for.
 * @param pipeline An array of pipeline objects.
 * @return A promise resolving to a URL string or null.
 */
async function fetchDocumentationUrl(
  prData: PullRequest,
  orgSlug: string,
  pipeline: Pipeline,
): Promise<string | null> {
  const docOverrideUrl = (pipeline.env || {}).GH_CONTROL_README_URL;
  if (docOverrideUrl) {
    const mapping = {
      COMMITISH: prData.head.sha,
      ORG: prData.base.user.login,
      REPO: prData.base.repo.name,
    };
    return template(docOverrideUrl, mapping);
  }

  const candidateUrl =
    '' +
    `https://api.github.com/repos/${prData.head.repo.full_name}/contents` +
    '/.buildkite/pipeline/description' +
    `/${orgSlug}/${pipeline.slug}.md?ref=${prData.head.sha}`;

  try {
    const res = await githubApiRequest<Contents>(candidateUrl);
    return res.html_url;
  } catch (e) {
    if (e instanceof Http404Error) {
      return null;
    }
    throw e;
  }
}

/**
 * Return a link to create a readme for a pipeline
 *
 * The link is to create a readme off of the green branch with text like:
 *
 *     # some-pipeline
 *
 *     [Document some-pipeline's RocketBot options here]
 *
 * A typical link looks something like:
 *
 *   https://github.com/some-org/some-repo
 *   /new/master
 *   /.buildkite/pipeline/description
 *   /canva-org?filename=some-pipeline.md
 *   &value=%23%20some-pipeline%0A%0A%5B
 *   Document%20some-pipeline%27s%20RocketBot%20options%20here%5D
 *
 * @param prData Data belonging to the PR which this markdown should be produced for.
 * @param orgSlug The Buildkite organization which this markdown should be produced for.
 * @param pipeline An array of pipeline objects.
 * @return {string} A link.
 */
function getDocumentationCreationLink(
  prData: PullRequest,
  orgSlug: string,
  pipeline: Pipeline,
) {
  return (
    '' +
    `https://github.com/${prData.head.repo.full_name}` +
    `/new/${prData.head.repo.default_branch}` +
    '/.buildkite/pipeline/description' +
    `/${orgSlug}?filename=${pipeline.slug}.md` +
    `&value=%23%20${pipeline.slug}%0A%0A%5B` +
    `Document%20${pipeline.slug}%27s%20RocketBot%20options%20here%5D`
  );
}

/**
 * Do what zip does in every other language ever
 */
function zip<S, T>(xs: S[], ys: T[]): [S, T][] {
  if (xs.length !== ys.length) {
    throw new Error('xs and ys must have the same length');
  }
  return xs.map((x, i) => [x, ys[i]]);
}

/**
 * Makes an HTTP request against the given Github API URL
 *
 * @param ghUrl The fully qualified URL of the Github API endpoint
 * @param additionalOptions An option object according to the 'https' node module.
 *                                    Conflicting keys will overwrite any default options.
 * @param requestBody The JSON body to send to Github
 * @return A promise resolving to the decoded JSON data of the Github API response
 */
async function githubApiRequest<T>(
  ghUrl: string,
  additionalOptions?: Partial<RequestOptions>,
  requestBody?: Record<string, unknown>,
): Promise<T> {
  const options = Object.assign(
    parse(ghUrl),
    {
      auth: `${GITHUB_USER}:${GITHUB_TOKEN}`,
    },
    additionalOptions || {},
  );
  const { body } = await jsonRequest<T>(options, requestBody);
  return body;
}

/* Buildkite API helper functions */

/**
 * Returns all defined Buildkite pipelines in the current organization
 *
 * @return A promise resolving to the decoded JSON data of the Buildkite API response
 */
async function buildkiteReadPipelines() {
  let pipelines: Pipeline[] = [];

  async function fetchNextPage(page: number) {
    const { body, headers } = await buildkiteApiRequest<Pipeline>(
      `pipelines?page=${page}&per_page=100`,
    );
    pipelines = pipelines.concat(body);
    return headers.link && headers.link.indexOf('rel="next"') !== -1;
  }

  let currentPage = 1;

  // eslint-disable-next-line no-await-in-loop
  while (await fetchNextPage(currentPage)) {
    currentPage += 1;
  }
  return pipelines;
}

/**
 * Incomplete (e.g. only the subset needed by this lambda) type descriptor for the response
 * of https://buildkite.com/docs/apis/rest-api/pipelines
 */
type Pipeline = {
  slug: string;
  repository: string;
  env?: Dict<string>;
  description?: string;
};

/**
 * Starts a buildkite build
 *
 * @param buildData The Buildkite data
 *        containing the build slug (/pipelines/$buildName/...) in .buildNames and any user-defined
 *        environment variables in .env (they will be available in the Buildkite build prefixed with
 *        `GH_CONTROL_USER_ENV_`.
 *        A user-defined environment variable X=Y would become GH_CONTROL_USER_ENV_X=Y
 * @param prData The pull request data
 * @param requester The github username of the person requesting the build
 * @param senderName The full name of the person requesting the build
 * @param commentUrl The URL of the comment requesting the build
 * @param senderEmail The email address of the person requesting the build
 * @return A promise resolving to the decoded JSON data of the Buildkite API response
 */
async function buildkiteStartBuild(
  buildData: { buildNames: string[]; env: NodeJS.ProcessEnv },
  prData: PullRequest,
  requester: string,
  commentUrl: string,
  senderName?: string,
  senderEmail?: string,
) {
  const branch = prData.head.ref;
  const commit = prData.head.sha;
  const requestBody = {
    commit,
    branch,
    message: `On-demand build for branch "${branch}" requested by @${requester} from PR #${prData.number}`,
    ignore_pipeline_branch_filters: true,
    author: {
      name: senderName,
      email: senderEmail,
    },
    env: {
      ...buildData.env,
      GH_CONTROL_BUILD: true,
      GH_CONTROL_GITHUB_USER: requester,
      GH_CONTROL_GITHUB_USER_EMAIL: senderEmail,
      GH_CONTROL_GITHUB_USER_NAME: senderName,
      GH_CONTROL_GITHUB_TRIGGER_COMMENT_URL: commentUrl,
      GH_CONTROL_PR_NUMBER: prData.number,
      GH_CONTROL_PR_TITLE: prData.title,
      GH_CONTROL_PR_BASE_BRANCH: prData.base.ref,
      GH_CONTROL_PR_BASE_REPO: prData.base.repo.full_name,
    },
  };
  return Promise.all(
    buildData.buildNames.map(async (buildName) => {
      const { body } = await buildkiteApiRequest<Build>(
        `pipelines/${buildName}/builds`,
        { method: 'POST' },
        requestBody,
      );
      return body;
    }),
  );
}

/**
 * Incomplete type descriptor of the https://buildkite.com/docs/apis/rest-api/builds#list-all-builds endpoint responses
 */
type Build = {
  web_url: string;
  number: number;
  scheduled_at: string;
};

/**
 * Makes an HTTP request against the Buildkite API v2.
 *
 * @param apiPathNoOrg The path of the endpoint behind the
 *                              organizational part without preceding slash
 * @param additionalOptions An option object according to the 'https' node module.
 *                                    Conflicting keys will overwrite any default options.
 * @param body The JSON body to send to Buildkite
 * @return A promise resolving to an object { body, headers},
 *                   where body is the decoded JSON data of the Buildkite API response and headers
 *                   is a map
 */
async function buildkiteApiRequest<T>(
  apiPathNoOrg: string,
  additionalOptions?: Partial<RequestOptions>,
  body?: Record<string, unknown>,
) {
  const options = {
    hostname: 'api.buildkite.com',
    path: `/v2/organizations/${BUILDKITE_ORG_NAME}/${apiPathNoOrg}`,
    headers: {
      Authorization: `Bearer ${BUILDKITE_TOKEN}`,
    },
    ...(additionalOptions || {}),
  };
  return jsonRequest<T>(options, body);
}

/* General helper functions */

/**
 * Makes an HTTP request against a given endpoint
 *
 * @return A promise resolving to an object { body, headers }
 *                   where body is the decoded JSON data of the endpoint response and headers
 *                   is a map
 */
async function jsonRequest<T = Record<string, unknown>>(
  options: Partial<RequestOptions>,
  jsonBody?: Record<string, unknown>,
): Promise<{ body: T; headers: IncomingHttpHeaders }> {
  const localOptions: RequestOptions = { ...options };
  localOptions.headers = Object.assign(options.headers || {}, {
    'User-Agent': 'githubHook/2.0.1', // Note: this is mandatory for the GitHub API
    'Content-Type': 'application/json',
  });

  let body: string;
  if (jsonBody) {
    body = JSON.stringify(jsonBody);
    localOptions.headers['Content-Length'] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const req = request(localOptions, (res) => {
      const { statusCode, headers } = res;
      const contentType = headers['content-type'];

      let error;
      if (statusCode === 404) {
        error = new Http404Error(`Request Failed. Status Code: ${statusCode}`);
      } else if (!statusCode || statusCode < 200 || statusCode >= 300) {
        error = new HttpError(`Request Failed. Status Code: ${statusCode}`);
      } else if (!contentType || !/^application\/json/.test(contentType)) {
        error = new Error(
          `Invalid content-type. Expected application/json but received ${contentType}`,
        );
      }
      if (error) {
        reject(error);
        // consume response data to free up memory
        res.resume();
        return;
      }

      res.setEncoding('utf8');
      let rawData = '';
      res.on('data', (chunk) => {
        rawData += chunk;
      });
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(rawData);
          resolve({ body: parsedData, headers });
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', (e) => {
      /* istanbul ignore next */
      reject(e);
    });
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

/**
 * Asserts that a given environment variable is set and returns it
 *
 * @return The value of the given environment variable
 * @throws {Error} if the environment variable is not set
 */
function assertEnv(name: string /* The name of the environment variable */) {
  const value = process.env[name];
  if (!value) {
    /* istanbul ignore next */
    throw new Error(`Required: "${name}" environment variable`);
  }
  return value;
}
