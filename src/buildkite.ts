import type { IncomingHttpHeaders } from 'http';
import type { RequestOptions } from 'https';
import { request } from 'https';
import type { Logger } from 'pino';
import type { Config } from './config';
import type { RestEndpointMethodTypes } from '@octokit/rest';
import type { PullRequest } from '@octokit/webhooks-types';

type Dict<T> = Record<string, T>;
type PullRequestData = RestEndpointMethodTypes['pulls']['get']['response']['data'];

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

/**
 * Returns all defined Buildkite pipelines in the current organization
 */
export async function buildkiteReadPipelines(
  logger: Logger,
  config: Config,
): Promise<Pipeline[]> {
  logger.debug('Reading pipelines');
  let pipelines: Pipeline[] = [];

  async function fetchNextPage(page: number) {
    const { body, headers } = await buildkiteApiRequest<Pipeline>(
      logger,
      config,
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
export type Pipeline = {
  slug: string;
  repository: string;
  env?: Dict<string>;
  description?: string | null;
};

/**
 * Starts one or more buildkite builds
 */
export async function buildkiteStartBuild(
  logger: Logger,
  config: Config,
  buildData: {
    buildNames: string[] /** the pipeline slugs */;
    env: NodeJS.ProcessEnv;
  },
  prData: PullRequestData | PullRequest,
  requester: string /** The github username of the person requesting the build */,
  commentUrl: string /** The URL of the comment requesting the build */,
  senderName?: string /** The full name of the person requesting the build */,
  senderEmail?: string /** The email address of the person requesting the build */,
): Promise<Build[]> {
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
      BUILDKITE_PULL_REQUEST: String(prData.number),
      BUILDKITE_PULL_REQUEST_BASE_BRANCH: prData.base.ref,
      BUILDKITE_PULL_REQUEST_REPO: prData.base.repo.ssh_url,
      GH_CONTROL_BUILD: true,
      GH_CONTROL_GITHUB_USER: requester,
      GH_CONTROL_GITHUB_USER_EMAIL: senderEmail,
      GH_CONTROL_GITHUB_USER_NAME: senderName,
      GH_CONTROL_GITHUB_TRIGGER_COMMENT_URL: commentUrl,
      GH_CONTROL_PR_NUMBER: String(prData.number),
      GH_CONTROL_PR_TITLE: prData.title,
      GH_CONTROL_PR_BASE_BRANCH: prData.base.ref,
      GH_CONTROL_PR_BASE_REPO: prData.base.repo.full_name,
    },
  };
  return Promise.all(
    buildData.buildNames.map(async (buildName) => {
      const { body } = await buildkiteApiRequest<Build>(
        logger,
        config,

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
export type Build = {
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
  logger: Logger,
  config: Config,
  apiPathNoOrg: string,
  additionalOptions?: Partial<RequestOptions>,
  body?: Record<string, unknown>,
) {
  const options = {
    hostname: 'api.buildkite.com',
    path: `/v2/organizations/${config.BUILDKITE_ORG_NAME}/${apiPathNoOrg}`,
    headers: {
      Authorization: `Bearer ${config.BUILDKITE_TOKEN}`,
    },
    ...(additionalOptions || {}),
  };
  return jsonRequest<T>(logger, options, body);
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
  logger: Logger,
  options: Partial<RequestOptions>,
  jsonBody?: Record<string, unknown>,
): Promise<{ body: T; headers: IncomingHttpHeaders }> {
  const localOptions: RequestOptions = { ...options };
  localOptions.headers = Object.assign(options.headers || {}, {
    'Content-Type': 'application/json',
  });

  logger.debug('Request: %o', {
    ...localOptions,
    headers: { ...localOptions.headers, Authorization: '<redacted>' },
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
