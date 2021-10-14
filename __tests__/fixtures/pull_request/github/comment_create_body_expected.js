module.exports = {
  body: `
:tada: Almost merged!
<details>
<summary>Request a branch build</summary>

By commenting on this PR with: \`:rocket:[<pipeline>]\`, e.g.


<details>
  <summary>a-pipeline</summary>

  \`\`\`
  :rocket:[a-pipeline]
  \`\`\`
  
  [See more information](https://example.com/does-templating-work?COMMITISH=c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffe&ORG=some-org&REPO=some-repo)

</details>

<details>
  <summary>some-pipeline</summary>

  \`\`\`
  :rocket:[some-pipeline]
  \`\`\`
  
  [Add more information](https://github.com/some-org/some-repo/new/master?filename=.buildkite%2Fpipeline%2Fdescription%2Fsome-org%2Fsome-pipeline.md&value=%23+some-pipeline%0A%0A%5BDocument+some-pipeline%27s+RocketBot+options+here%5D)

</details>

<details>
  <summary>This is a proper description with a \\| pipe</summary>

  \`\`\`
  :rocket:[some-pipeline-lite]
  \`\`\`
  
  [See more information](https://github.com/some-org/some-repo/blob/master/.buildkite/pipeline/description/some-org/some-pipeline-lite.md)

</details>

_Note: you can pass [custom environment variables](https://github.com/canva-public/rocketbot/blob/main/docs/guides/pass-in-variables.md) to some builds._

> Pro-Tip: It is also possible to run multiple builds at once, like this: \`:rocket:[<pipeline-1>][...][<pipeline-n>]\`
</details>`,
};
