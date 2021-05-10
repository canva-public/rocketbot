import type { Logger } from 'pino';
import type { Config } from './config';
import type { RestEndpointMethodTypes } from '@octokit/rest';
import type { PullRequest } from '@octokit/webhooks-types';
import got from 'got';
import memoizeOne from 'memoize-one';

type Dict<T> = Record<string, T>;
type PullRequestData = RestEndpointMethodTypes['pulls']['get']['response']['data'];

const gotInstance = memoizeOne((config: Config) => {
  return got.extend({
    prefixUrl: `https://api.buildkite.com/v2/organizations/${config.BUILDKITE_ORG_NAME}`,
    headers: {
      Authorization: `Bearer ${config.BUILDKITE_TOKEN}`,
    },
    responseType: 'json',
  });
});

/**
 * Returns all defined Buildkite pipelines in the current organization
 */
export async function buildkiteReadPipelines(
  logger: Logger,
  config: Config,
): Promise<Pipeline[]> {
  logger.debug('Reading pipelines');

  const {
    paginate: { all },
  } = gotInstance(config);

  return all<Pipeline>('pipelines', {
    searchParams: {
      page: 1,
      per_page: 100,
    },
    pagination: {
      paginate: (response) => {
        const { headers } = response;
        if (!headers.link || headers.link.indexOf('rel="next"') === -1) {
          return false;
        }
        const previousSearchParams = response.request.options.searchParams;
        const previousPage = previousSearchParams?.get('page');
        return {
          searchParams: {
            ...previousSearchParams,
            page: Number(previousPage) + 1,
          },
        };
      },
    },
  });
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
  const { post } = gotInstance(config);
  return Promise.all(
    buildData.buildNames.map(async (buildName) => {
      const { body } = await post<Build>(`pipelines/${buildName}/builds`, {
        json: requestBody,
      });
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
