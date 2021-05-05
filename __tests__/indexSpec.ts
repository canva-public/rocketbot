import { ok } from 'assert';
import { APIGatewayProxyResult, Context } from 'aws-lambda';
import nock from 'nock';
import * as path from 'path';

process.env.BUILDKITE_TOKEN = process.env.BUILDKITE_TOKEN || '__bk-token';
process.env.BUILDKITE_ORG_NAME = process.env.BUILDKITE_ORG_NAME || 'some-org';
process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN || '__gh-token';
process.env.GITHUB_USER = process.env.GITHUB_USER || 'some-bot-user';

import * as githubControl from '../src';

// Enable this to record HTTP requests when adding a new test
// nock.recorder.rec();

function loadFixture(fixturePath: string) {
  // eslint-disable-next-line global-require
  return require(path.join(__dirname, 'fixtures', fixturePath));
}

function assertLambdaResponse(
  response: APIGatewayProxyResult | undefined,
  expectedStatus: APIGatewayProxyResult['statusCode'],
  expectedBody: githubControl.JSONResponse,
) {
  ok(response);
  expect(response.statusCode).toStrictEqual(expectedStatus);
  expect(JSON.parse(response.body)).toStrictEqual(expectedBody);
}

function assertNockDone() {
  if (!nock.isDone()) {
    // eslint-disable-next-line no-console
    console.error(`pending mocks: ${nock.pendingMocks()}`);
  }
  expect(nock.isDone()).toBe(true);
}

describe('github-control', () => {
  let context: Context;
  beforeEach(() => {
    context = (jest.fn<Context, never>() as unknown) as Context;
  });
  describe('general', () => {
    describe('comment matching', () => {
      it('should match a simple comment', () => {
        expect.hasAssertions();
        expect(githubControl.isTriggerComment(':rocket:[x-build]')).toBe(true);
      });
      it('should match a comment with the emoji', () => {
        expect.hasAssertions();
        expect(githubControl.isTriggerComment('🚀[x-build]')).toBe(true);
      });
      it('should match a comment with lots of whitespace', () => {
        expect.hasAssertions();
        expect(
          githubControl.isTriggerComment(
            '    :rocket:      [    x-build    ]     ',
          ),
        ).toBe(true);
      });
      it('should match a comment that is quoted', () => {
        expect.hasAssertions();
        expect(githubControl.isTriggerComment('> :rocket:[x-build]\n\n')).toBe(
          true,
        );
      });
      it('should match a comment that is quoted and has leading whitespace', () => {
        expect.hasAssertions();
        expect(
          githubControl.isTriggerComment('      > :rocket:[x-build]\n\n'),
        ).toBe(true);
      });
      it('should match a comment that has multiple pipelines', () => {
        expect.hasAssertions();
        expect(
          githubControl.isTriggerComment('> :rocket:[x-build][y-build]\n\n'),
        ).toBe(true);
      });
      it('should match a comment that has multiple pipelines with whitespace', () => {
        expect.hasAssertions();
        expect(
          githubControl.isTriggerComment(
            '> :rocket:[x-build]    [y-build]\n\n',
          ),
        ).toBe(true);
      });
      it('should match a comment that has multiple rockets', () => {
        expect.hasAssertions();
        expect(
          githubControl.isTriggerComment(
            ':rocket:[x-build]\n    :rocket:[y-build]\n\n',
          ),
        ).toBe(true);
      });
      it('should match a comment that is quoted and has multiple rockets', () => {
        expect.hasAssertions();
        expect(
          githubControl.isTriggerComment(
            '> :rocket:[x-build][z-build]\n\n    > :rocket:[y-build]\n\n',
          ),
        ).toBe(true);
      });
      describe('env vars', () => {
        it('should match a comment with env vars', () => {
          expect.hasAssertions();
          const markdown = `
          :rocket:[x-build]
          \`\`\`ini
          A=a
          B=b
          C=
          
          D
          E=e
          =f
          some-forbidden.chars=x
          \`\`\`
`;
          expect(githubControl.isTriggerComment(markdown)).toBe(true);
        });

        it('should match a comment with empty env vars', () => {
          expect.hasAssertions();
          const markdown = `
          :rocket:[x-build]
          \`\`\`ini
          \`\`\`
`;
          expect(githubControl.isTriggerComment(markdown)).toBe(true);
        });

        it('should match a comment with env vars that have no highlighting', () => {
          expect.hasAssertions();
          const markdown = `
          :rocket:[x-build]
          \`\`\`
          A=a
          \`\`\`
`;
          expect(githubControl.isTriggerComment(markdown)).toBe(true);
        });
      });
    });

    describe('comment parsing', () => {
      it('should be possible for simple comments', () => {
        expect.hasAssertions();
        expect(
          githubControl.parseTriggerComment(':rocket:[x-build]').buildNames,
        ).toStrictEqual(['x-build']);
      });
      it('should be possible for simple comments wrapped in ` characters', () => {
        expect.hasAssertions();
        expect(
          githubControl.parseTriggerComment('> `:rocket:[x-build]`').buildNames,
        ).toStrictEqual(['x-build']);
      });
      it('should be possible for comments with emoji', () => {
        expect.hasAssertions();
        expect(
          githubControl.parseTriggerComment('🚀[x-build]').buildNames,
        ).toStrictEqual(['x-build']);
      });
      it('should be possible for comments with lots of whitespace', () => {
        expect.hasAssertions();
        expect(
          githubControl.parseTriggerComment(
            '    :rocket:      [    x-build    ]     ',
          ).buildNames,
        ).toStrictEqual(['x-build']);
      });
      it('should be possible for comments with lots of whitespace wrapped in ` characters', () => {
        expect.hasAssertions();
        expect(
          githubControl.parseTriggerComment(
            '    `  :rocket:      [    x-build    ]    `  ',
          ).buildNames,
        ).toStrictEqual(['x-build']);
      });
      it('should be possible for comments with multiple builds', () => {
        expect.hasAssertions();
        expect(
          githubControl.parseTriggerComment(':rocket:[x-build][y-build]')
            .buildNames,
        ).toStrictEqual(['x-build', 'y-build']);
      });
      it('should be possible for comments with multiple builds that have whitespace', () => {
        expect.hasAssertions();
        expect(
          githubControl.parseTriggerComment(
            ':rocket:  [x-build]       [y-build]    ',
          ).buildNames,
        ).toStrictEqual(['x-build', 'y-build']);
      });
      it('should be possible for comments with multiple rockets on separate lines', () => {
        expect.hasAssertions();
        const markdown = `
          :rocket:[x-build][y-build]
          :rocket:[z-build]
`;
        expect(
          githubControl.parseTriggerComment(markdown).buildNames,
        ).toStrictEqual(['x-build', 'y-build', 'z-build']);
      });

      it('should be possible for quoted comments with multiple rockets on separate lines', () => {
        expect.hasAssertions();
        const markdown = `
          > :rocket:[x-build][y-build]

          > :rocket:[z-build]
`;
        expect(
          githubControl.parseTriggerComment(markdown).buildNames,
        ).toStrictEqual(['x-build', 'y-build', 'z-build']);
      });

      it('should be possible for quoted comments with multiple rockets on separate lines wrapped with ` chracter', () => {
        expect.hasAssertions();
        const markdown = `
              > \`:rocket:[x-build][y-build]\`
    
              > \`:rocket:[z-build]\`
`;
        expect(
          githubControl.parseTriggerComment(markdown).buildNames,
        ).toStrictEqual(['x-build', 'y-build', 'z-build']);
      });

      describe('env vars', () => {
        it('should be parsed properly', () => {
          expect.hasAssertions();
          const markdown = `
          :rocket:[x-build]
          \`\`\`ini
          TRAILING_KEY_SPACES  =a
          LEADING_VALUE_SPACES=  b
          EMPTY_VALUE=
          
          
          NO_VALUE
          E=e
          =f
          some-forbidden.chars=x
          multiple=equal=signs
          KEEP_case=really do
          QUOTED_ENV="Some \\"fancy\\" var"
          \`\`\`
`;
          const expected = {
            buildNames: ['x-build'],
            env: {
              TRAILING_KEY_SPACES: 'a',
              LEADING_VALUE_SPACES: 'b',
              EMPTY_VALUE: '',
              NO_VALUE: '',
              E: 'e',
              multiple: 'equal=signs',
              KEEP_case: 'really do',
              QUOTED_ENV: 'Some "fancy" var',
            },
          };

          expect(githubControl.parseTriggerComment(markdown)).toStrictEqual(
            expected,
          );
        });

        it('should be able to deal with an empty block', () => {
          expect.hasAssertions();
          const markdown = `
          :rocket:[x-build]
          \`\`\`ini
          \`\`\`
`;
          const expected = {
            buildNames: ['x-build'],
            env: {},
          };

          expect(githubControl.parseTriggerComment(markdown)).toStrictEqual(
            expected,
          );
        });

        it('should be able to deal with a non-highlighted block', () => {
          expect.hasAssertions();
          const markdown = `
          :rocket:[x-build]
          \`\`\`
          A=a
          \`\`\`
`;
          const expected = {
            buildNames: ['x-build'],
            env: {
              A: 'a',
            },
          };

          expect(githubControl.parseTriggerComment(markdown)).toStrictEqual(
            expected,
          );
        });
      });
    });
  });

  describe('with mocked requests', () => {
    beforeEach(() => {
      nock.disableNetConnect();
    });
    afterEach(() => {
      nock.enableNetConnect();
      nock.cleanAll();
    });

    it('should ignore anything that is not a POST', async () => {
      expect.hasAssertions();
      const lambdaRequest = loadFixture('lambda_request_GET');
      await githubControl.handler(lambdaRequest, context, (err, res) => {
        if (err) {
          throw err;
        }
        assertLambdaResponse(res, 400, {
          error: 'Unsupported method "GET"',
        });
      });
    });

    it('should ignore unsupported github events', async () => {
      expect.hasAssertions();
      const lambdaRequest = loadFixture('commit_comment/lambda_request');
      await githubControl.handler(lambdaRequest, context, (err, res) => {
        if (err) {
          throw err;
        }
        assertLambdaResponse(res, 400, {
          error: 'Unsupported event type "commit_comment"',
        });
      });
    });

    it('should gracefully handle non-JSON requests', async () => {
      expect.hasAssertions();
      const lambdaRequest = loadFixture('lambda_request_no_JSON');

      // The error messages differ in different node versions (e.g. 4.3.2 vs. 7.5.0)
      let errorMessage;
      try {
        JSON.parse(lambdaRequest.body);
      } catch (e) {
        errorMessage = e.message;
      }

      await expect(
        githubControl.handler(lambdaRequest, context, jest.fn()),
      ).rejects.toStrictEqual(
        new Error(`Could not parse event body: ${errorMessage}`),
      );
    });

    it('should gracefully handle a failing buildkite request', async () => {
      expect.hasAssertions();
      const lambdaRequest = loadFixture('pull_request/lambda_request');

      nock('https://api.buildkite.com:443')
        .get('/v2/organizations/some-org/pipelines?page=1&per_page=100')
        .reply(401, { message: 'Authorization failed' });

      await githubControl.handler(lambdaRequest, context, (err, res) => {
        if (err) {
          throw err;
        }
        assertNockDone();
        assertLambdaResponse(res, 400, {
          error: 'Request Failed. Status Code: 401',
        });
      });
    });

    it('should gracefully handle a failing github request', async () => {
      expect.hasAssertions();
      const lambdaRequest = loadFixture('pull_request/lambda_request');
      const pipelinesReply = loadFixture('pull_request/buildkite/pipelines');

      nock('https://api.buildkite.com:443')
        .get('/v2/organizations/some-org/pipelines?page=1&per_page=100')
        .reply(200, pipelinesReply);

      nock('https://api.github.com:443')
        .get(
          '/repos/some-org/some-repo/contents/.buildkite/pipeline/description' +
            '/some-org/some-pipeline.md' +
            '?ref=c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffe',
        )
        .reply(401, {
          message: 'Bad credentials',
          documentation_url: 'https://developer.github.com/v3',
        });

      nock('https://api.github.com:443')
        .get(
          '/repos/some-org/some-repo/contents/.buildkite/pipeline/description' +
            '/some-org/some-pipeline-lite.md' +
            '?ref=c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffe',
        )
        .reply(401, {
          message: 'Bad credentials',
          documentation_url: 'https://developer.github.com/v3',
        });

      await githubControl.handler(lambdaRequest, context, (err, res) => {
        if (err) {
          throw err;
        }
        assertNockDone();
        assertLambdaResponse(res, 400, {
          error: 'Request Failed. Status Code: 401',
        });
      });
    });

    it('should gracefully handle non-JSON responses', async () => {
      expect.hasAssertions();
      const lambdaRequest = loadFixture('pull_request/lambda_request');

      nock('https://api.buildkite.com:443')
        .get('/v2/organizations/some-org/pipelines?page=1&per_page=100')
        .reply(200, 'This is no JSON', {
          'Content-Type': 'text/plain',
        });

      await githubControl.handler(lambdaRequest, context, (err, res) => {
        if (err) {
          throw err;
        }
        assertNockDone();
        assertLambdaResponse(res, 400, {
          error:
            'Invalid content-type. Expected application/json but received text/plain',
        });
      });
    });

    it('should gracefully handle broken JSON responses', async () => {
      expect.hasAssertions();
      const lambdaRequest = loadFixture(
        'pull_request_review_comment/lambda_request',
      );

      const body = 'This is no JSON';

      // The error messages differ in different node versions (e.g. 4.3.2 vs. 7.5.0)
      let errorMessage: string;
      try {
        JSON.parse(body);
      } catch (e) {
        errorMessage = e.message;
      }

      nock('https://api.github.com:443')
        .get('/users/some-user')
        .reply(200, body, {
          'Content-Type': 'application/json',
        });

      await githubControl.handler(lambdaRequest, context, (err, res) => {
        if (err) {
          throw err;
        }
        assertNockDone();
        assertLambdaResponse(res, 400, {
          error: errorMessage,
        });
      });
    });

    describe('ping', () => {
      it('should properly handle a ping', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture('ping/lambda_request');
        await githubControl.handler(lambdaRequest, context, (err, res) => {
          if (err) {
            throw err;
          }
          assertLambdaResponse(res, 200, {
            commented: false,
            success: true,
            triggered: false,
            message: 'Hooks working for some-org/test-repo',
          });
        });
      });

      it('should complain if the events set up are not enough', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture('ping/lambda_request_no_events');
        await githubControl.handler(lambdaRequest, context, (err, res) => {
          if (err) {
            throw err;
          }
          assertLambdaResponse(res, 400, {
            error: 'Configure at least the delivery of issue comments',
          });
        });
      });
    });

    describe('pull_request', () => {
      it('should ignore when pull requests change state except when they are opened', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture('pull_request/lambda_pr_assigned');
        await githubControl.handler(lambdaRequest, context, (err, res) => {
          if (err) {
            throw err;
          }
          assertLambdaResponse(res, 200, {
            success: true,
            triggered: false,
          });
        });
      });

      it('should not post a comment to github about the usage when no pipelines match', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture('pull_request/lambda_request');
        const pipelinesReply = loadFixture(
          'pull_request/buildkite/no_matching_pipelines',
        );

        nock('https://api.buildkite.com:443')
          .get('/v2/organizations/some-org/pipelines?page=1&per_page=100')
          .reply(200, pipelinesReply);

        await githubControl.handler(lambdaRequest, context, (err, res) => {
          if (err) {
            throw err;
          }
          assertNockDone();
          assertLambdaResponse(res, 200, {
            success: true,
            triggered: false,
            commented: false,
          });
        });
      });

      it('should post a comment to github about the usage when a pull request is opened', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture('pull_request/lambda_request');
        const pipelinesReply = loadFixture('pull_request/buildkite/pipelines');
        const createdCommentReply = loadFixture(
          'pull_request/github/comment_create',
        );
        const expectedCommentCreationBody = loadFixture(
          'pull_request/github/comment_create_body_expected',
        );
        const docSomePipelineLite = loadFixture(
          'pull_request/github/doc_some_pipeline_lite',
        );
        const docSomePipeline = loadFixture(
          'pull_request/github/doc_some_pipeline',
        );

        nock('https://api.buildkite.com:443')
          .get('/v2/organizations/some-org/pipelines?page=1&per_page=100')
          .reply(200, pipelinesReply);

        nock('https://api.github.com:443')
          .post(
            '/repos/some-org/some-repo/issues/1111111/comments',
            expectedCommentCreationBody,
          )
          .reply(201, createdCommentReply);

        nock('https://api.github.com:443')
          .get(
            '/repos/some-org/some-repo/contents/.buildkite/pipeline/description' +
              '/some-org/some-pipeline-lite.md' +
              '?ref=c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffe',
          )
          .reply(200, docSomePipelineLite);

        nock('https://api.github.com:443')
          .get(
            '/repos/some-org/some-repo/contents/.buildkite/pipeline/description' +
              '/some-org/some-pipeline.md' +
              '?ref=c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffe',
          )
          .reply(404, docSomePipeline);

        await githubControl.handler(lambdaRequest, context, (err, res) => {
          if (err) {
            throw err;
          }
          assertNockDone();
          assertLambdaResponse(res, 200, {
            success: true,
            triggered: false,
            commented: true,
            commentUrl:
              'https://github.com/some-org/some-repo/pull/1111111#issuecomment-280987786',
          });
        });
      });

      it('should page when there are more pages', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture('pull_request/lambda_request');
        const pipelinesReply = loadFixture('pull_request/buildkite/pipelines');
        const pipelinesReplyPage2 = loadFixture(
          'pull_request/buildkite/pipelines_page2',
        );

        nock('https://api.buildkite.com:443')
          .get('/v2/organizations/some-org/pipelines?page=1&per_page=100')
          .reply(200, pipelinesReply, {
            Link:
              '<https://api.buildkite.com/v2/organizations/my-great-org/pipelines?page=2&per_page=100>; rel="next", <https://api.buildkite.com/v2/organizations/some-org/pipelines?page=2&per_page=100>; rel="last"',
          });

        nock('https://api.buildkite.com:443')
          .get('/v2/organizations/some-org/pipelines?page=2&per_page=100')
          .reply(200, pipelinesReplyPage2);

        await githubControl.handler(lambdaRequest, context, (err) => {
          if (err) {
            throw err;
          }
          assertNockDone();
        });
      });
    });

    describe('issue_comment', () => {
      it('should start a build when an issue comment requests it', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture('issue_comment/lambda_request');
        const usersReply = loadFixture('github/users_some-user');
        const pullRequestReply = loadFixture(
          'issue_comment/github/pull_request',
        );
        const buildkiteCreateBuildReply = loadFixture(
          'issue_comment/buildkite/create_build',
        );
        const expectedBuildkiteCreateBody = loadFixture(
          'issue_comment/buildkite/create_build_body_expected',
        );
        const updateCommentReply = loadFixture(
          'issue_comment/github/update_comment',
        );
        const expectedGithubUpdateCommentBody = loadFixture(
          'issue_comment/github/update_comment_body_expected',
        );

        nock('https://api.github.com:443')
          .get('/users/some-user')
          .reply(200, usersReply);

        nock('https://api.github.com:443')
          .get('/repos/some-org/some-repo/pulls/9500')
          .reply(200, pullRequestReply);

        nock('https://api.buildkite.com:443')
          .post(
            '/v2/organizations/some-org/pipelines/some-pipeline-lite/builds',
            expectedBuildkiteCreateBody,
          )
          .reply(201, buildkiteCreateBuildReply);

        nock('https://api.github.com:443')
          .patch(
            '/repos/some-org/some-repo/issues/comments/1111111',
            expectedGithubUpdateCommentBody,
          )
          .reply(200, updateCommentReply);

        await githubControl.handler(lambdaRequest, context, (err, res) => {
          if (err) {
            throw err;
          }
          assertNockDone();
          assertLambdaResponse(res, 200, {
            success: true,
            triggered: true,
            commented: false,
            updatedCommentUrl:
              'https://github.com/some-org/some-repo/pull/9500#issuecomment-279928810',
          });
        });
      });

      it('should start multiple builds when an issue comment requests it', async () => {
        expect.hasAssertions();
        const lambdaRequestMultiBuild = loadFixture(
          'issue_comment/lambda_request_multi_build',
        );
        const usersReply = loadFixture('github/users_some-user');
        const pullRequestReply = loadFixture(
          'issue_comment/github/pull_request',
        );
        const buildkiteCreateBuildReply = loadFixture(
          'issue_comment/buildkite/create_build',
        );
        const buildkiteCreateBuildReplyOther = loadFixture(
          'issue_comment/buildkite/create_build_other',
        );
        const expectedBuildkiteCreateBody = loadFixture(
          'issue_comment/buildkite/create_build_body_expected',
        );
        const updateCommentReply = loadFixture(
          'issue_comment/github/update_comment',
        );
        const expectedGithubUpdateCommentBodyMultiple = loadFixture(
          'issue_comment/github/update_comment_body_expected_multiple',
        );

        nock('https://api.github.com:443')
          .get('/users/some-user')
          .reply(200, usersReply);

        nock('https://api.github.com:443')
          .get('/repos/some-org/some-repo/pulls/9500')
          .reply(200, pullRequestReply);

        nock('https://api.buildkite.com:443')
          .post(
            '/v2/organizations/some-org/pipelines/some-pipeline-lite/builds',
            expectedBuildkiteCreateBody,
          )
          .reply(201, buildkiteCreateBuildReply);

        nock('https://api.buildkite.com:443')
          .post(
            '/v2/organizations/some-org/pipelines/deploy-pipeline/builds',
            expectedBuildkiteCreateBody,
          )
          .reply(201, buildkiteCreateBuildReplyOther);

        nock('https://api.github.com:443')
          .patch(
            '/repos/some-org/some-repo/issues/comments/1111111',
            expectedGithubUpdateCommentBodyMultiple,
          )
          .reply(200, updateCommentReply);

        await githubControl.handler(
          lambdaRequestMultiBuild,
          context,
          (err, res) => {
            if (err) {
              throw err;
            }
            assertNockDone();
            assertLambdaResponse(res, 200, {
              success: true,
              triggered: true,
              commented: false,
              updatedCommentUrl:
                'https://github.com/some-org/some-repo/pull/9500#issuecomment-279928810',
            });
          },
        );
      });

      it('should start a build with environment variables when an issue comment requests it', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture(
          'issue_comment/lambda_request_with_ENV',
        );
        const usersReply = loadFixture('github/users_some-user');
        const pullRequestReply = loadFixture(
          'issue_comment/github/pull_request',
        );
        const buildkiteCreateBuildReply = loadFixture(
          'issue_comment/buildkite/create_build',
        );
        const expectedBuildkiteCreateBody = loadFixture(
          'issue_comment/buildkite/create_build_body_expected_with_ENV',
        );
        const updateCommentReply = loadFixture(
          'issue_comment/github/update_comment_with_ENV',
        );
        const expectedGithubUpdateCommentBody = loadFixture(
          'issue_comment/github/update_comment_body_expected_with_ENV',
        );

        nock('https://api.github.com:443')
          .get('/users/some-user')
          .reply(200, usersReply);

        nock('https://api.github.com:443')
          .get('/repos/some-org/some-repo/pulls/9500')
          .reply(200, pullRequestReply);

        nock('https://api.buildkite.com:443')
          .post(
            '/v2/organizations/some-org/pipelines/some-pipeline-lite/builds',
            expectedBuildkiteCreateBody,
          )
          .reply(201, buildkiteCreateBuildReply);

        nock('https://api.github.com:443')
          .patch(
            '/repos/some-org/some-repo/issues/comments/1111111',
            expectedGithubUpdateCommentBody,
          )
          .reply(200, updateCommentReply);

        await githubControl.handler(lambdaRequest, context, (err, res) => {
          if (err) {
            throw err;
          }
          assertNockDone();
          assertLambdaResponse(res, 200, {
            success: true,
            triggered: true,
            commented: false,
            updatedCommentUrl:
              'https://github.com/some-org/some-repo/pull/9500#issuecomment-279928810',
          });
        });
      });

      it('should ignore bot comments', async () => {
        expect.hasAssertions();
        // The user in this mock request must match the bot user above
        const lambdaRequest = loadFixture(
          'issue_comment/lambda_request_by_bot',
        );

        await githubControl.handler(lambdaRequest, context, (err, res) => {
          if (err) {
            throw err;
          }
          assertNockDone();
          assertLambdaResponse(res, 200, {
            success: true,
            triggered: false,
          });
        });
      });

      it('should ignore deleted comments', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture(
          'issue_comment/lambda_request_comment_deleted',
        );

        await githubControl.handler(lambdaRequest, context, (err, res) => {
          if (err) {
            throw err;
          }
          assertNockDone();
          assertLambdaResponse(res, 200, {
            success: true,
            triggered: false,
          });
        });
      });

      it('should ignore comments not attached to pull requests', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture('issue_comment/lambda_request_no_pr');

        await githubControl.handler(lambdaRequest, context, (err, res) => {
          if (err) {
            throw err;
          }
          assertNockDone();
          assertLambdaResponse(res, 200, {
            success: true,
            triggered: false,
          });
        });
      });
    });

    describe('pull_request_review_comment', () => {
      it('should start a build when a pull request review comment requests it', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture(
          'pull_request_review_comment/lambda_request',
        );
        const usersReply = loadFixture('github/users_some-user');
        const buildkiteCreateBuildReply = loadFixture(
          'pull_request_review_comment/buildkite/create_build',
        );
        const buildkiteCreateBuildExpectedBody = loadFixture(
          'pull_request_review_comment/buildkite/create_build_body_expected',
        );
        const updateCommentReply = loadFixture(
          'pull_request_review_comment/github/update_comment',
        );
        const expectedGuithubUpdateCommentBody = loadFixture(
          'pull_request_review_comment/github/update_comment_body_expected',
        );

        nock('https://api.github.com:443')
          .get('/users/some-user')
          .reply(200, usersReply);

        nock('https://api.buildkite.com:443')
          .post(
            '/v2/organizations/some-org/pipelines/some-pipeline-lite/builds',
            buildkiteCreateBuildExpectedBody,
          )
          .reply(201, buildkiteCreateBuildReply);

        nock('https://api.github.com:443')
          .patch(
            '/repos/some-org/some-repo/pulls/comments/1111111',
            expectedGuithubUpdateCommentBody,
          )
          .reply(200, updateCommentReply);

        await githubControl.handler(lambdaRequest, context, (err, res) => {
          if (err) {
            throw err;
          }
          assertNockDone();
          assertLambdaResponse(res, 200, {
            success: true,
            triggered: true,
            commented: false,
            updatedCommentUrl:
              'https://github.com/some-org/some-repo/pull/1111111#discussion_r101434594',
          });
        });
      });

      it('should ignore comments that do not contain a build marker', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture(
          'pull_request_review_comment/lambda_request_random_comment',
        );

        await githubControl.handler(lambdaRequest, context, (err, res) => {
          if (err) {
            throw err;
          }
          assertLambdaResponse(res, 200, {
            success: true,
            triggered: false,
          });
        });
      });
    });
  });
});