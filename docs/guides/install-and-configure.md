# Install and configure RocketBot

## Credentials

Because RocketBot is the glue between Github and Buildkite it will need credentials for both systems.
### On the Buildkite side

You need a Buildkite API key to access the following scopes:

- `read_builds`
- `write_builds`
- `read_pipelines`

The Buildkite API key only needs access to the REST endpoint. It doesn't need GraphQL access.

### On the GitHub side

There are two ways to configure RocketBot:

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

Make the following environment variables available to your Lambda function:

- `BUILDKITE_TOKEN`
- `BUILDKITE_ORG_NAME` (the URL part of `https://buildkite.com/<your-org>/`)

Depending on which GitHub way you choose to configure RocketBot, you need to expose either:

- `GITHUB_APP_APP_ID` (see above)
- `GITHUB_APP_PRIVATE_KEY` (see above)
- `GITHUB_APP_INSTALLATION_ID` (see above)

or

- `GITHUB_TOKEN` (a personal access token of a user with write access)
