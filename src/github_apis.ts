import type { RequestError } from '@octokit/types';
import { createAppAuth } from '@octokit/auth-app';
import memoizeOne from 'memoize-one';
import type { Logger } from 'pino';
import type { Config } from './config';
import { Octokit } from '@octokit/rest';
import { graphql } from '@octokit/graphql';
import { retry } from '@octokit/plugin-retry';

export type GithubApis = { octokit: Octokit; graphql: typeof graphql };

/**
 * Type guard for Octokit request errors
 */
export function isOctokitRequestError(e: unknown): e is RequestError {
  return (
    typeof e === 'object' &&
    e != null &&
    'name' in e &&
    'status' in e &&
    'documentation_url' in e
  );
}

export const getGithubApis = memoizeOne(async function (
  config: Config,
  logger: Logger,
): Promise<GithubApis> {
  const octokitBaseConfig = {
    log: {
      debug: (message: string) => logger.debug(message),
      info: (message: string) => logger.info(message),
      warn: (message: string) => logger.warn(message),
      error: (message: string) => logger.error(message),
    },
  };
  const OctokitWithPlugins =
    config.GITHUB_RETRY_FAILED_REQUESTS === 'true'
      ? Octokit.plugin(retry)
      : Octokit;

  if ('GITHUB_APP_APP_ID' in config) {
    logger.debug('Using app credentials');
    const auth = {
      appId: config.GITHUB_APP_APP_ID,
      privateKey: config.GITHUB_APP_PRIVATE_KEY,
      installationId: config.GITHUB_APP_INSTALLATION_ID,
    };
    return {
      octokit: new OctokitWithPlugins({
        ...octokitBaseConfig,
        authStrategy: createAppAuth,
        auth,
      }),
      graphql: graphql.defaults({
        request: {
          hook: createAppAuth(auth).hook,
        },
      }),
    };
  } else {
    logger.debug('Using user credentials');
    return {
      octokit: new OctokitWithPlugins({
        ...octokitBaseConfig,
        auth: config.GITHUB_TOKEN,
      }),
      graphql: graphql.defaults({
        headers: {
          authorization: `token ${config.GITHUB_TOKEN}`,
        },
      }),
    };
  }
});
