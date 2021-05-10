# Install and configure RocketBot

## Credentials

Because RocketBot is the glue between GitHub and Buildkite it will need credentials for both systems.

### On the Buildkite side

You need a Buildkite API key to access the following scopes:

- `read_builds`
- `write_builds`
- `read_pipelines`

The Buildkite API key only needs access to the REST endpoint. It doesn't need GraphQL access.

### On the GitHub side

There are two ways to configure RocketBot for GitHub:

- Through a user: Ensure the RocketBot GitHub user has write access to the repository. Write access is required for posting and updating comments, as well as reading PR statuses.
- Through an app (recommended):

  1. Create a new GitHub app and add the following permissions:
     - `Contents`: `Read only`
     - `Issues`: `Read & write`
     - `Pull requests`: `Read & write`
  1. Retrieve the app ID and produce a private key file.
  1. Install the app in your organization.
  1. Retrieve the installation ID from `https://github.com/organizations/<org>/settings/installations/<installationId>`.

## Configuration

RocketBot can read configuration data in two different ways:

1. via AWS SecretsManager (recommended)
2. via env variables

The configuration data schema is:

```ts
type Config = {
  BUILDKITE_TOKEN: string; // A REST API token with scopes: read_builds, write_builds, read_pipelines
  BUILDKITE_ORG_NAME: string; // (the URL part of `https://buildkite.com/<your-org>/`)
  ENABLE_DEBUG: string; // defaults to "false"
} & (
  | // RocketBot uses a GitHub app. Recommended.
  {
      GITHUB_APP_APP_ID: string;
      // make sure to keep the preamble and newlines, e.g.: `"-----BEGIN RSA PRIVATE KEY-----\nline 1\nline 2\n-----END RSA PRIVATE KEY-----\n"
      GITHUB_APP_PRIVATE_KEY: string;
      GITHUB_APP_INSTALLATION_ID: string;
    }
  // RocketBot uses a personal access token. Not recommended.
  | {
      GITHUB_TOKEN: string; // a personal access token of a user with write access
    }
);
```

You can either provide a key for AWS SecretsManager via a

- `SECRETSMANAGER_CONFIG_KEY`

variable, which holds a JSON object satisfying the above schema (recommended)

or you make the following environment variables available to your Lambda function:

- `BUILDKITE_TOKEN`
- `BUILDKITE_ORG_NAME`

Depending on which GitHub way you choose to configure RocketBot, you need to expose either:

- `GITHUB_APP_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_INSTALLATION_ID`

or

- `GITHUB_TOKEN`

Optional:

- `ENABLE_DEBUG` (if set to `true`, logging will be enabled)

### Order of preference

The order of preference in which the configuration is loaded and interpreted is as following

#### Where to fetch the config data from

1. use the data from AWS SecretsManager under the given ket if the `SECRETSMANAGER_CONFIG_KEY` env var is populated with a value
2. if not try to use env vars
3. fail if neither a secretsmanager key or a complete set of env vars is given

#### How the config data is read

1. use a github app if `GITHUB_APP_APP_ID` is in the configuration object
2. fall back to use `GITHUB_TOKEN` token if not
3. fail if neither a full set of app credentials or a github token is given
