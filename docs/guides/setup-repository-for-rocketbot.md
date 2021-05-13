# Set up a repository to work with RocketBot

To set up a repository to work with RocketBot:

1. In the GitHub UI for the repository, click **Settings**.
1. Under **Options**, click **Webhooks**, then click **Add webhook**.
1. In **Payload URL**, enter the API gateway URL to where you deployed the RocketBot Lambda. For example, `https://xxxx.execute-api.us-east-1.amazonaws.com/flavor/xxx`.
1. In **Content type**, select **application/json**.
1. (Optional, but recommended): In **Secret** enter the [webhook secret](https://docs.github.com/en/developers/webhooks-and-events/securing-your-webhooks) that you configured RocketBot with.
1. Under **Which events would you like to trigger this webhook?**, select **Let me select individual events**, then select:
   - **Issue comment**
   - **Pull request**
   - **Pull request review comment**
1. Select **Active**.
1. Click **Add webhook**.

## Enable a Buildkite pipeline to display in the list of available builds

Buildkite pipelines display in the list of available builds for a PR when:

- The build pipeline repository matches the one where the PR was opened. For example, you don't want pipelines for one repository displaying for PRs in a different repository.
- The build pipeline is marked as available for branch builds.

To mark a pipeline as available for branch builds, you can either:

- Add `GH_CONTROL_IS_VALID_BRANCH_BUILD=true` to the `Environment Variables` section of the build.
- Add `GH_CONTROL_IS_VALID_BRANCH_BUILD: true` it to the build yaml file.

  ```yaml
  env:
    GH_CONTROL_IS_VALID_BRANCH_BUILD: true

  steps:
  ```
