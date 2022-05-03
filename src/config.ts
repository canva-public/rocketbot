import { z } from 'zod';
import { SecretsManager } from 'aws-sdk';
import memoizeOne from 'memoize-one';

const SECRETSMANAGER_CONFIG_KEY = 'SECRETSMANAGER_CONFIG_KEY';
export const GITHUB_WEBHOOK_SECRET_KEY = 'GITHUB_WEBHOOK_SECRET';

const BaseConfig = z.object({
  /** needs: read_builds, write_builds, read_pipelines */
  BUILDKITE_TOKEN: z.string(),
  BUILDKITE_ORG_NAME: z.string(),
  ENABLE_DEBUG: z.string().optional(),
  [GITHUB_WEBHOOK_SECRET_KEY]: z.string().optional(),
  COLLAPSE_OLD_COMMENTS: z.string().optional().default('true'),
  GITHUB_RETRY_FAILED_REQUESTS: z.string().optional().default('true'),
});

export const Config = z.union([
  BaseConfig.extend({
    GITHUB_APP_APP_ID: z.string(),
    GITHUB_APP_PRIVATE_KEY: z.string(),
    GITHUB_APP_INSTALLATION_ID: z.string(),
  }),
  BaseConfig.extend({
    /** needs write access */
    GITHUB_TOKEN: z.string(),
  }),
]);

export type Config = z.infer<typeof Config>;

const getSecretValue = memoizeOne(async (SecretId: string) => {
  const client = new SecretsManager();

  const value = await client.getSecretValue({ SecretId }).promise();
  return Config.parse(JSON.parse(value.SecretString ?? ''));
});

export const getConfig = async function (
  env: NodeJS.ProcessEnv,
): Promise<Config> {
  const secretsManagerKey = env[SECRETSMANAGER_CONFIG_KEY];
  if (secretsManagerKey) {
    // if we have a secretsmanager config key, we use that to load the config
    const config = await getSecretValue(secretsManagerKey);
    // Fall back to env var for `GITHUB_WEBHOOK_SECRET`
    config.GITHUB_WEBHOOK_SECRET =
      config.GITHUB_WEBHOOK_SECRET ?? process.env[GITHUB_WEBHOOK_SECRET_KEY];
    return config;
  } else {
    const config = Config.parse(env);
    return config;
  }
};
