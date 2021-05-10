import { ok } from 'assert';
import { z } from 'zod';
import { SecretsManager } from 'aws-sdk';
import memoizeOne from 'memoize-one';

const SECRETSMANAGER_CONFIG_KEY = 'SECRETSMANAGER_CONFIG_KEY';

const BaseConfig = z.object({
  /** needs: read_builds, write_builds, read_pipelines */
  BUILDKITE_TOKEN: z.string(),
  BUILDKITE_ORG_NAME: z.string(),
  ENABLE_DEBUG: z.string().optional(),
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

export const getConfig = memoizeOne(async function (
  env: NodeJS.ProcessEnv,
): Promise<Config> {
  const secretsManagerKey = env[SECRETSMANAGER_CONFIG_KEY];
  if (secretsManagerKey) {
    // if we have a secretsmanager config key, we use that to load the config
    ok(secretsManagerKey);
    const client = new SecretsManager();

    const value = await client
      .getSecretValue({ SecretId: secretsManagerKey })
      .promise();
    return Config.parse(JSON.parse(value.SecretString ?? ''));
  } else {
    return Config.parse(env);
  }
});
