module.exports = {
  body: `
:tada: Almost merged!
<details>
<summary>Request a branch build</summary>

By commenting on this PR with: \`:rocket:[<pipeline>]\`, e.g.

| Comment | Description | More info |
| --- | --- | --- |
| \`:rocket:[a-pipeline]\` |  | [:information_source:](https://example.com/does-templating-work?COMMITISH=c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffe&ORG=some-org&REPO=some-repo "See more information") |
| \`:rocket:[some-pipeline]\` |  | [:heavy_plus_sign:](https://github.com/some-org/some-repo/new/master/.buildkite/pipeline/description/some-org?filename=some-pipeline.md&value=%23%20some-pipeline%0A%0A%5BDocument%20some-pipeline%27s%20RocketBot%20options%20here%5D "Add more information") |
| \`:rocket:[some-pipeline-lite]\` | This is a proper description with a \\| pipe | [:information_source:](https://github.com/some-org/some-repo/blob/master/.buildkite/pipeline/description/some-org/some-pipeline-lite.md "See more information") |

_Note: you can pass [custom environment variables](https://github.com/canva-public/rocketbot/blob/main/docs/guides/pass-in-variables.md) to some builds._

> Pro-Tip: It is also possible to run multiple builds at once, like this: \`:rocket:[<pipeline-1>][...][<pipeline-n>]\`
</details>`,
};
