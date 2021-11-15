// we match something like:
// --- 8< ---
// :rocket:[build-name-a][optional-build-name-b][optional-build-name-c]
// :rocket:[build-name-d]
// ```ini
// OPTIONAL_ENV_VAR=xyz
// ANOTHER_ONE=abc
// ```
// --- 8< ---
// ignoring all whitespace
const preamblePattern = '\\s*>?\\s*`?\\s*(?:🚀|:rocket:)';
const pipelineNameRegex = /([\w-]+)/g;
const pipelineNamesPattern = '(?:\\s*\\[\\s*[\\w-]+\\s*\\])+\\s*`?';
const rocketPattern = `${preamblePattern}(${pipelineNamesPattern})`;
const envSectionPattern = '(?:```(?:ini)?\\s*((?:.|\\s)+?)\\s*(?:```)?\\s*)?';
const buildTriggerRegex = new RegExp(
  `^(${rocketPattern}\\s*)+\\s*${envSectionPattern}$`,
);

/**
 * Determines whether a given comment contains the preamble
 * @param commentBody
 * @return {boolean}
 */
export function hasPreamble(commentBody: string): boolean {
  return new RegExp(`^${preamblePattern}`).test(commentBody);
}

/**
 * Transforms an env variable block into an object
 *
 * A=a
 * B=b
 * C=c
 *
 * would become
 * {
 * A: 'a',
 * B: 'b',
 * C: 'c'
 * }
 */
function parseEnvBlock(
  envBlock: string /* The environment variable block to parse */,
) {
  return envBlock
    .split('\n') // one env definition per line
    .map((line) => line.split(/=(.*)/).slice(0, 2)) // split into env key/value pairs
    .map((tuple) => tuple.map((part) => part.trim())) // make sure each pair is a trimmed string
    .filter((tuple) => /^\w+$/.test(tuple[0])) // filter empty and invalid keys
    .map(([k, v]) => {
      let value = v || '';
      if (/^"(.*)"$/.test(value)) {
        value = JSON.parse(value); // decode quoted vars
      }
      return [k, value];
    })
    .reduce<NodeJS.ProcessEnv>((ret, [k, v]) => {
      ret[k] = v;
      return ret;
    }, {});
}

/**
 * Parses a markdown trigger comment into an object with the build information
 */
export function parseTriggerComment(
  commentBody: string,
): {
  buildNames: string[];
  env: NodeJS.ProcessEnv;
} {
  const match = commentBody.match(buildTriggerRegex);
  // TODO: ensure that matches are mapped properly - either with named captures and/or non-capturing groups
  const pipelinesBlock = match ? match[0] : '';
  const envBlock = match ? match[3] : null;

  const rockets = pipelinesBlock.match(new RegExp(rocketPattern, 'g')) || [];

  const buildNames = rockets.reduce<string[]>((acc, rocket) => {
    const pipelineNames = rocket.match(rocketPattern)?.[1];
    if (pipelineNames) {
      const buildName = pipelineNames.match(pipelineNameRegex);
      if (buildName?.length) {
        return [...acc, ...buildName];
      }
    }
    return acc;
  }, []);

  return {
    buildNames,
    env: envBlock ? parseEnvBlock(envBlock) : {},
  };
}
