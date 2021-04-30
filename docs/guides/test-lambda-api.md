# Testing

In this guide you'll learn how to test the Lambda function and the API gateway.

## Test the Lambda function

Test the Lambda function using the [test fixtures](https://github.com/canva-public/rocketbot/tree/main/__tests__/fixtures), and using the **Test** button in the AWS console. See a simple [test fixtures example file](https://github.com/canva-public/rocketbot/blob/main/__tests__/fixtures/issue_comment/lambda_request.json).

## Test the API gateway

Test the API gateway with the following sample.

Set the headers as follows:

```
X-GitHub-Event:issue_comment
content-type:application/json
```

In the body of the JSON file, replace `@SOMEBUILD@` with an actual pipeline build slug, for example, `buildkite-pipeline-slug`.

```json
{
  "action": "created",
  "issue": {
    "url": "https://api.github.com/repos/some-org/some-repo/issues/111",
    "comments_url": "https://api.github.com/repos/some-org/some-repo/issues/111/comments",
    "html_url": "https://github.com/some-org/some-repo/pull/111",
    "number": 111,
    "title": "test",
    "user": {
      "login": "some-user",
      "url": "https://api.github.com/users/some-user"
    },
    "pull_request": {
      "url": "https://api.github.com/repos/some-org/some-repo/pulls/111",
      "html_url": "https://github.com/some-org/some-repo/pull/111"
    }
  },
  "comment": {
    "url": "https://api.github.com/repos/some-org/some-repo/issues/comments/279928810",
    "html_url": "https://github.com/some-org/some-repo/pull/111#issuecomment-279928810",
    "issue_url": "https://api.github.com/repos/some-org/some-repo/issues/111",
    "user": {
      "login": "some-user",
      "url": "https://api.github.com/users/some-user",
      "html_url": "https://github.com/some-user"
    },
    "body": ":rocket: [@SOMEBUILD@]"
  },
  "repository": {
    "full_name": "your-org/repo",
    "html_url": "https://github.com/some-org/some-repo",
    "url": "https://api.github.com/repos/some-org/some-repo"
  },
  "sender": {
    "login": "some-user",
    "url": "https://api.github.com/users/some-user",
    "html_url": "https://github.com/some-user"
  }
}
```

View the [result](https://github.com/some-org/some-repo/pull/111#issuecomment-279928810).
