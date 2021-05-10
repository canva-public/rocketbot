import type { RequestError } from '@octokit/types';
import { createAppAuth } from '@octokit/auth-app';
import memoizeOne from 'memoize-one';
import type { Logger } from 'pino';
import type { Config } from './config';
import { Octokit } from '@octokit/rest';

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

export const getOctokit = memoizeOne(async function (
  config: Config,
  logger: Logger,
) {
  const octokitBaseConfig = {
    log: {
      debug: (message: string) => logger.debug(message),
      info: (message: string) => logger.info(message),
      warn: (message: string) => logger.warn(message),
      error: (message: string) => logger.error(message),
    },
  };

  if ('GITHUB_APP_APP_ID' in config) {
    logger.debug('Using app credentials');
    return new Octokit({
      ...octokitBaseConfig,
      authStrategy: createAppAuth,
      auth: {
        appId: config.GITHUB_APP_APP_ID,
        privateKey: config.GITHUB_APP_PRIVATE_KEY,
        installationId: config.GITHUB_APP_INSTALLATION_ID,
      },
    });
  } else {
    logger.debug('Using user credentials');
    return new Octokit({
      ...octokitBaseConfig,
      auth: config.GITHUB_TOKEN,
    });
  }
});
