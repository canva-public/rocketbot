module.exports = {
  body: `
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
<tr>
<td>

\`\`\`
:rocket:[a-pipeline]
\`\`\`

</td>
<td>



</td>
<td>

[:information_source:](https://example.com/does-templating-work?COMMITISH=c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffe&ORG=some-org&REPO=some-repo "See more information")

</td>
</tr>
<tr>
<td>

\`\`\`
:rocket:[some-pipeline]
\`\`\`

</td>
<td>



</td>
<td>

[:heavy_plus_sign:](https://github.com/some-org/some-repo/new/master?filename=.buildkite%2Fpipeline%2Fdescription%2Fsome-org%2Fsome-pipeline.md&value=%23+some-pipeline%0A%0A%5BDocument+some-pipeline%27s+RocketBot+options+here%5D "Add more information")

</td>
</tr>
<tr>
<td>

\`\`\`
:rocket:[some-pipeline-lite]
\`\`\`

</td>
<td>

This is a proper description with a \\| pipe

</td>
<td>

[:information_source:](https://github.com/some-org/some-repo/blob/master/.buildkite/pipeline/description/some-org/some-pipeline-lite.md "See more information")

</td>
</tr>
</tbody>
</table>

_Note: you can pass [custom environment variables](https://github.com/canva-public/rocketbot/blob/main/docs/guides/pass-in-variables.md) to some builds._

> Pro-Tip: It is also possible to run multiple builds at once, like this: \`:rocket:[<pipeline-1>][...][<pipeline-n>]\`
</details>`,
};
