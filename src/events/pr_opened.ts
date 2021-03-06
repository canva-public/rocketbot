import { PullRequestEvent } from '@octokit/webhooks-types';
import { Logger } from 'pino';
import { Config } from '../config';
import { buildkiteReadPipelines, Pipeline } from '../buildkite';
import { fetchDocumentationLinkMds } from '../initial_comment';
import { githubAddComment } from '../github';
import sortBy from 'lodash.sortby';
import { JSONResponse } from '../response';
import gitUrlParse, { GitUrl } from 'git-url-parse';
import { GithubApis } from '../github_apis';

const validBranchBuildEnvVarMarker = 'GH_CONTROL_IS_VALID_BRANCH_BUILD';

export function isMarkedPipeline(
  eventGitUrl: GitUrl,
  pipeline: Pick<Pipeline, 'env' | 'repository'>,
): boolean {
  if (!(validBranchBuildEnvVarMarker in (pipeline.env || {}))) {
    // is not enabled for branch builds
    return false;
  }

  const pipelineGitUrl = gitUrlParse(pipeline.repository);
  if (
    pipelineGitUrl.name !== eventGitUrl.name ||
    pipelineGitUrl.owner !== eventGitUrl.owner
  ) {
    // current repo does not correspond to the pull request repo
    return false;
  }
  return true;
}

export async function prOpened(
  eventBody: PullRequestEvent,
  logger: Logger,
  config: Config,
  apis: GithubApis,
): Promise<JSONResponse> {
  if (eventBody.action !== 'opened') {
    logger.info('PR was not opened, nothing to do here');
    return { success: true, triggered: false };
  }
  const repoSshUrl = eventBody.repository.ssh_url;
  const eventGitUrl = gitUrlParse(repoSshUrl);

  logger.info('PR was opened');
  const pipelineData = await buildkiteReadPipelines(logger, config);

  const pipelines = pipelineData.filter(
    isMarkedPipeline.bind(null, eventGitUrl),
  );

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

  const { octokit } = apis;
  const links = await fetchDocumentationLinkMds(
    octokit,
    logger,
    eventBody.repository,
    eventBody.pull_request,
    config.BUILDKITE_ORG_NAME,
    pipelines,
  );

  const pipelineList = sortBy(pipelines, ['slug'])
    .map(({ slug, description: desc }) => {
      // TODO: proper markdown sanitization
      const description = (desc?.trim() ?? '').trim().replace(/\|/g, '\\|');
      // We need raw HTML tables to be able to insert a code block to enable Github's copy button
      return `<tr>
<td>

\`\`\`
:rocket:[${slug}]
\`\`\`

</td>
<td>

${description}

</td>
<td>

${links[slug]}

</td>
</tr>`;
    })
    .join('\n');
  const commentData = await githubAddComment(
    octokit,
    logger,
    eventBody.repository,
    eventBody.pull_request.number,
    `
:tada: Almost merged!
<details>
<summary>Request a branch build</summary>

By commenting on this PR with: \`:rocket:[<pipeline>]\`, e.g.

<table>
<thead>
<tr>
<th>Comment</th>
<th>Description</th>
<th>More info</th>
</tr>
</thead>
<tbody>
${pipelineList}
</tbody>
</table>

_Note: you can pass [custom environment variables](https://github.com/canva-public/rocketbot/blob/main/docs/guides/pass-in-variables.md) to some builds._

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
