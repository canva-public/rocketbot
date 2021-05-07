# Install and configure RocketBot

## Credentials

### On the Buildkite side

You need a Buildkite API key to access the following scopes:

The will will need access to the scopes:

- `read_builds`
- `write_builds`
- `read_pipelines`

The Buildkite API key only needs access to the REST endpoint. It doesn't need GraphQL access.

### On the GitHub side

There are two ways to configure RocketBot:

1. Via a user: Ensure the github user used for RocketBot has write access to the repository. Write access is required for posting and updating comments, as well as reading PR statuses.
2. Via app (recommended):

- Create a new github app and add the following permissions:
  - `Contents`: `Read only`
  - `Issues`: `Read & write`
  - `Pull requests`: `Read & write`
- Grab the app ID and produce a private key file
- Install the app in your organization
- Grab the installation ID from `https://github.com/organizations/<org>/settings/installations/<installationId>`

## Configuration

Make the following environment variables available to your lambda:

- `BUILDKITE_TOKEN`
- `BUILDKITE_ORG_NAME` (the URL part of `https://buildkite.com/<your-org>/`)

Depending on which Github way you chooe, you will need to expose either:

- `GITHUB_APP_APP_ID` (see above)
- `GITHUB_APP_PRIVATE_KEY` (see above)
- `GITHUB_APP_INSTALLATION_ID` (see above)

or

- `GITHUB_TOKEN` (a personal access token of a user with write access)
