## Pass in custom variables

You can pass custom variables into your build. For example:

````
:rocket:[buildkite-pipeline-slug]
```
MY_VAR=value
another_one=bla
QUOTED_VAR="Some quoted value"
```
````

builds the `buildkite-pipeline-slug` pipeline with the following variables set:

```
GH_CONTROL_USER_ENV_MY_VAR="value"
GH_CONTROL_USER_ENV_another_one="bla"
GH_CONTROL_USER_ENV_QUOTED_VAR="Some quoted value"
```
