import { PullRequestEvent } from '@octokit/webhooks-types';
import { Logger } from 'pino';
import { Config } from '../config';
import { buildkiteReadPipelines } from '../buildkite';
import { fetchDocumentationLinkMds } from '../initial_comment';
import { urlPart } from '../url_part';
import { githubAddComment } from '../github';
import { Octokit } from '@octokit/rest';
import sortBy from 'lodash.sortby';
import { JSONResponse } from '../response';

export async function prOpened(
  eventBody: PullRequestEvent,
  logger: Logger,
  config: Config,
  octokit: Octokit,
): Promise<JSONResponse> {
  if (eventBody.action !== 'opened') {
    logger.info('PR was not opened, nothing to do here');
    return { success: true, triggered: false };
  }
  const repoSshUrl = eventBody.repository.ssh_url;

  logger.info('PR was opened');
  const pipelineData = await buildkiteReadPipelines(logger, config);

  const pipelines = pipelineData
    // is enabled for branch builds
    .filter(
      (pipeline) => 'GH_CONTROL_IS_VALID_BRANCH_BUILD' in (pipeline.env || {}),
    )
    // corresponds to the pull request repo
    .filter((pipeline) => urlPart(pipeline.repository) === urlPart(repoSshUrl));

  if (!pipelines.length) {
    logger.info(
      'No matching/enabled pipelines for this repository, nothing to do here',
    );
    return {
      success: true,
      triggered: false,
      commented: false,
    };
  }

  const links = await fetchDocumentationLinkMds(
    octokit,
    logger,
    eventBody.repository,
    eventBody.pull_request,
    config.BUILDKITE_ORG_NAME,
    pipelines,
  );

  const pipelineList = sortBy(pipelines, ['slug'])
    .map(
      ({ slug, description }) =>
        `| \`:rocket:[${slug}]\` | ${(description?.trim() ?? '')
          .trim()
          .replace(/\|/g, '\\|')} | ${links[slug]} |`,
    )
    .join('\n');
  const commentData = await githubAddComment(
    octokit,
    logger,
    eventBody.repository,
    eventBody.pull_request,
    `
:tada: Almost merged!
<details>
<summary>Request a branch build</summary>

By commenting on this PR with: \`:rocket:[<pipeline>]\`, e.g.

| Comment | Description | More info |
| --- | --- | --- |
${pipelineList}

_Note: you can pass [custom environment variables](https://github.com/some-org/some-repo/blob/master/tools/github-control/#passing-custom-environment-variables) to some builds._

> Pro-Tip: It is also possible to run multiple builds at once, like this: \`:rocket:[<pipeline-1>][...][<pipeline-n>]\`
</details>`,
  );

  logger.info(
    `Left a comment ${commentData.html_url} on how to start branch builds on ${eventBody.pull_request.html_url}`,
  );
  return {
    success: true,
    triggered: false,
    commented: true,
    commentUrl: commentData.html_url,
  };
}
