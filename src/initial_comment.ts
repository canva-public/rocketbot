import type { Logger } from 'pino';
import type { Octokit } from '@octokit/rest';
import type { PullRequest, Repository } from '@octokit/webhooks-types';
import type { Pipeline } from './buildkite';
import { isOctokitRequestError } from './octokit';
import type { RestEndpointMethodTypes } from '@octokit/rest';

type Dict<T> = Record<string, T>;
type Unarray<T> = T extends Array<infer U> ? U : T;
type Contents = Unarray<
  RestEndpointMethodTypes['repos']['getContent']['response']['data']
>;

/**
 * Templates a string
 *
 * Variables in the string are given using Bash-like syntax (e.g. $var or
 * ${var}).
 */
function template(
  templateString: string,
  mapping: Dict<string> /* A mapping from a variable name to its value. */,
): string {
  function reducer(haystack: string, mappingEntry: [string, string]) {
    const [varName, replacement] = mappingEntry;
    const needle = new RegExp(
      // eslint-disable-next-line prefer-template, no-multi-spaces, operator-linebreak, no-useless-concat
      '(\\$' + varName + '(?![a-zA-Z0-9]))|' + '(\\${' + varName + '})',
      'g',
    );
    return haystack.replace(needle, replacement);
  }
  return Object.entries(mapping).reduce(reducer, templateString);
}

/**
 * Fetch data to produce markdown linking to documentation a single pipeline
 */
export async function fetchDocumentationLinkMds(
  octokit: Octokit,
  logger: Logger,
  repository: Repository /** The repository this pull request belongs to */,
  prData: PullRequest,
  orgSlug: string,
  pipelines: Pipeline[],
): Promise<Dict<string>> {
  const documentationUrls = await fetchDocumentationUrls(
    octokit,
    logger,
    repository,
    prData,
    orgSlug,
    pipelines,
  );

  return pipelines.reduce<Dict<string>>((acc, pipeline) => {
    const documentationUrl = documentationUrls[pipeline.slug];
    acc[pipeline.slug] = documentationUrl
      ? `[:information_source:](${documentationUrl} "See more information")`
      : `[:heavy_plus_sign:](${getDocumentationCreationLink(
          prData,
          orgSlug,
          pipeline,
        )} "Add more information")`;
    return acc;
  }, {});
}

/**
 * Fetch the URL linking to documentation for a pipeline
 */
async function fetchDocumentationUrls(
  octokit: Octokit,
  logger: Logger,
  repository: Repository,
  prData: PullRequest,
  orgSlug: string,
  pipelines: Pipeline[],
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};
  let contents: readonly Contents[] | undefined;

  const pathPrefix = `.buildkite/pipeline/description/${orgSlug}`;

  for (const pipeline of pipelines) {
    const docOverrideUrl = pipeline.env?.GH_CONTROL_README_URL;
    if (docOverrideUrl) {
      const mapping = {
        COMMITISH: prData.head.sha,
        ORG: repository.owner.login,
        REPO: repository.name,
      };
      result[pipeline.slug] = template(docOverrideUrl, mapping);
    } else {
      if (!contents) {
        try {
          // Caveat: this only fetches the first 1000 files
          // if there are other files nested in between the pipeline mds
          // or there are more than 1000 documented pipelines we will need
          // paging here
          const response = await octokit.repos.getContent({
            owner: repository.owner.login,
            repo: repository.name,
            path: pathPrefix,
            ref: prData.head.sha,
          });
          contents = Array.isArray(response.data)
            ? response.data
            : [response.data];
          logger.debug('contents of %s: %o', pathPrefix, contents);
        } catch (e) {
          if (!isOctokitRequestError(e) || e.status !== 404) {
            // something else than Octokit failed or it's not a 404
            throw e;
          }
          logger.debug(
            'no pipeline documentation files found for repository %s and Buildkite org %s',
            repository.full_name,
            orgSlug,
          );
          contents = [];
        }
      }
      const mdFile = contents.find(
        (file) => file.path === `${pathPrefix}/${pipeline.slug}.md`,
      );
      result[pipeline.slug] = mdFile?.html_url ?? null;
    }
  }
  return result;
}

/**
 * Return a link to create a readme for a pipeline
 *
 * The link is to create a readme off of the green branch with text like:
 *
 *     # some-pipeline
 *
 *     [Document some-pipeline's RocketBot options here]
 *
 * A typical link looks something like:
 *
 *   https://github.com/some-org/some-repo
 *   /new/master
 *   /.buildkite/pipeline/description
 *   /canva-org?filename=some-pipeline.md
 *   &value=%23%20some-pipeline%0A%0A%5B
 *   Document%20some-pipeline%27s%20RocketBot%20options%20here%5D
 */
function getDocumentationCreationLink(
  prData: PullRequest,
  orgSlug: string,
  pipeline: Pipeline,
) {
  return (
    `https://github.com/${prData.head.repo.full_name}` +
    `/new/${prData.head.repo.default_branch}` +
    '/.buildkite/pipeline/description' +
    `/${orgSlug}?filename=${pipeline.slug}.md` +
    `&value=%23%20${pipeline.slug}%0A%0A%5B` +
    `Document%20${pipeline.slug}%27s%20RocketBot%20options%20here%5D`
  );
}
