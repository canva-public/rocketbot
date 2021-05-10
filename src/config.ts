import { z } from 'zod';

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
