process.env.BUILDKITE_TOKEN = process.env.BUILDKITE_TOKEN || '__bk-token';
process.env.BUILDKITE_ORG_NAME = process.env.BUILDKITE_ORG_NAME || 'some-org';
process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN || '__gh-token';
process.env.ENABLE_DEBUG = process.env.ENABLE_DEBUG || 'false';
process.env.GITHUB_RETRY_FAILED_REQUESTS =
  process.env.GITHUB_RETRY_FAILED_REQUESTS || 'false';

import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';
import { isTriggerComment, parseTriggerComment } from '../src/trigger';
import type { JSONResponse } from '../src/response';
import { handler } from '../src/index';
import { join } from 'path';
import { GITHUB_WEBHOOK_SECRET_KEY } from '../src/config';
import { sign } from '@octokit/webhooks-methods';
import { ok } from 'assert';
import { readFileSync } from 'fs';
import { BuildkiteBuildRequest } from '../src/buildkite';
import nock from 'nock';
import {
  commentsReq,
  CommentsRequestData,
  mutationReq,
} from '../src/events/commented';

// Enable this to record HTTP requests when adding a new test
// nock.recorder.rec();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadFixture<T = any>(fixturePath: string): T {
  return JSON.parse(
    readFileSync(join(__dirname, 'fixtures', `${fixturePath}.json`), 'utf8'),
  );
}

function assertLambdaResponse(
  response: APIGatewayProxyResult,
  expectedStatus: APIGatewayProxyResult['statusCode'],
  expectedBody: JSONResponse,
) {
  expect({ ...response, body: JSON.parse(response.body) }).toStrictEqual(
    expect.objectContaining({
      statusCode: expectedStatus,
      body: expectedBody,
      headers: {
        'Content-Type': 'application/json',
      },
    }),
  );
}

function assertNockDone() {
  if (!nock.isDone()) {
    // eslint-disable-next-line no-console
    console.error(`pending mocks: ${nock.pendingMocks()}`);
  }
  expect(nock.isDone()).toBe(true);
}

describe('github-control', () => {
  const context = (jest.fn<Context, never>() as unknown) as Context;
  describe('general', () => {
    describe('comment matching', () => {
      it('should match a simple comment', () => {
        expect.hasAssertions();
        expect(isTriggerComment(':rocket:[x-build]')).toBe(true);
      });
      it('should match a comment with the emoji', () => {
        expect.hasAssertions();
        expect(isTriggerComment('🚀[x-build]')).toBe(true);
      });
      it('should match a comment with lots of whitespace', () => {
        expect.hasAssertions();
        expect(
          isTriggerComment('    :rocket:      [    x-build    ]     '),
        ).toBe(true);
      });
      it('should match a comment that is quoted', () => {
        expect.hasAssertions();
        expect(isTriggerComment('> :rocket:[x-build]\n\n')).toBe(true);
      });
      it('should match a comment that is quoted and has leading whitespace', () => {
        expect.hasAssertions();
        expect(isTriggerComment('      > :rocket:[x-build]\n\n')).toBe(true);
      });
      it('should match a comment that has multiple pipelines', () => {
        expect.hasAssertions();
        expect(isTriggerComment('> :rocket:[x-build][y-build]\n\n')).toBe(true);
      });
      it('should match a comment that has multiple pipelines with whitespace', () => {
        expect.hasAssertions();
        expect(isTriggerComment('> :rocket:[x-build]    [y-build]\n\n')).toBe(
          true,
        );
      });
      it('should match a comment that has multiple rockets', () => {
        expect.hasAssertions();
        expect(
          isTriggerComment(':rocket:[x-build]\n    :rocket:[y-build]\n\n'),
        ).toBe(true);
      });
      it('should match a comment that is quoted and has multiple rockets', () => {
        expect.hasAssertions();
        expect(
          isTriggerComment(
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
          expect(isTriggerComment(markdown)).toBe(true);
        });

        it('should match a comment with empty env vars', () => {
          expect.hasAssertions();
          const markdown = `
          :rocket:[x-build]
          \`\`\`ini
          \`\`\`
`;
          expect(isTriggerComment(markdown)).toBe(true);
        });

        it('should match a comment with env vars that have no highlighting', () => {
          expect.hasAssertions();
          const markdown = `
          :rocket:[x-build]
          \`\`\`
          A=a
          \`\`\`
`;
          expect(isTriggerComment(markdown)).toBe(true);
        });
      });
    });

    describe('comment parsing', () => {
      it('should be possible for simple comments', () => {
        expect.hasAssertions();
        expect(
          parseTriggerComment(':rocket:[x-build]').buildNames,
        ).toStrictEqual(['x-build']);
      });
      it('should be possible for simple comments wrapped in ` characters', () => {
        expect.hasAssertions();
        expect(
          parseTriggerComment('> `:rocket:[x-build]`').buildNames,
        ).toStrictEqual(['x-build']);
      });
      it('should be possible for comments with emoji', () => {
        expect.hasAssertions();
        expect(parseTriggerComment('🚀[x-build]').buildNames).toStrictEqual([
          'x-build',
        ]);
      });
      it('should be possible for comments with lots of whitespace', () => {
        expect.hasAssertions();
        expect(
          parseTriggerComment('    :rocket:      [    x-build    ]     ')
            .buildNames,
        ).toStrictEqual(['x-build']);
      });
      it('should be possible for comments with lots of whitespace wrapped in ` characters', () => {
        expect.hasAssertions();
        expect(
          parseTriggerComment('    `  :rocket:      [    x-build    ]    `  ')
            .buildNames,
        ).toStrictEqual(['x-build']);
      });
      it('should be possible for comments with multiple builds', () => {
        expect.hasAssertions();
        expect(
          parseTriggerComment(':rocket:[x-build][y-build]').buildNames,
        ).toStrictEqual(['x-build', 'y-build']);
      });
      it('should be possible for comments with multiple builds that have whitespace', () => {
        expect.hasAssertions();
        expect(
          parseTriggerComment(':rocket:  [x-build]       [y-build]    ')
            .buildNames,
        ).toStrictEqual(['x-build', 'y-build']);
      });
      it('should be possible for comments with multiple rockets on separate lines', () => {
        expect.hasAssertions();
        const markdown = `
          :rocket:[x-build][y-build]
          :rocket:[z-build]
`;
        expect(parseTriggerComment(markdown).buildNames).toStrictEqual([
          'x-build',
          'y-build',
          'z-build',
        ]);
      });

      it('should be possible for quoted comments with multiple rockets on separate lines', () => {
        expect.hasAssertions();
        const markdown = `
          > :rocket:[x-build][y-build]

          > :rocket:[z-build]
`;
        expect(parseTriggerComment(markdown).buildNames).toStrictEqual([
          'x-build',
          'y-build',
          'z-build',
        ]);
      });

      it('should be possible for quoted comments with multiple rockets on separate lines wrapped with ` chracter', () => {
        expect.hasAssertions();
        const markdown = `
              > \`:rocket:[x-build][y-build]\`
    
              > \`:rocket:[z-build]\`
`;
        expect(parseTriggerComment(markdown).buildNames).toStrictEqual([
          'x-build',
          'y-build',
          'z-build',
        ]);
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

          expect(parseTriggerComment(markdown)).toStrictEqual(expected);
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

          expect(parseTriggerComment(markdown)).toStrictEqual(expected);
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

          expect(parseTriggerComment(markdown)).toStrictEqual(expected);
        });

        it('should be able to deal with an unclosed block', () => {
          expect.hasAssertions();
          const markdown = `
          :rocket:[x-build]
          \`\`\`
          A=a
`;
          const expected = {
            buildNames: ['x-build'],
            env: {
              A: 'a',
            },
          };

          expect(parseTriggerComment(markdown)).toStrictEqual(expected);
        });
      });
    });
  });

  describe('with mocked requests', () => {
    // eslint-disable-next-line jest/no-hooks
    beforeEach(() => {
      nock.disableNetConnect();
    });
    // eslint-disable-next-line jest/no-hooks
    afterEach(() => {
      nock.enableNetConnect();
      nock.cleanAll();
    });

    it('should ignore anything that is not a POST', async () => {
      expect.hasAssertions();
      const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
        'lambda_request_GET',
      );
      const res = await handler(lambdaRequest, context);
      assertLambdaResponse(res, 400, {
        error: 'Unsupported method "GET"',
      });
    });

    it('should ignore unsupported github events', async () => {
      expect.hasAssertions();
      const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
        'commit_comment/lambda_request',
      );
      const res = await handler(lambdaRequest, context);
      assertLambdaResponse(res, 400, {
        error: 'Unsupported event type "commit_comment"',
      });
    });

    it('should gracefully handle non-JSON requests', async () => {
      expect.hasAssertions();
      const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
        'lambda_request_no_JSON',
      );
      ok(lambdaRequest.body);
      try {
        JSON.parse(lambdaRequest.body);
      } catch (e) {
        // The error messages differ in different node versions (e.g. 4.3.2 vs. 7.5.0)
        const res = await handler(lambdaRequest, context);
        assertLambdaResponse(res, 400, {
          error: `Could not parse event body: ${e.message}`,
        });
      }
    });

    it('should gracefully handle a failing buildkite request', async () => {
      expect.hasAssertions();
      const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
        'pull_request/lambda_request',
      );

      nock('https://api.buildkite.com')
        .get('/v2/organizations/some-org/pipelines?page=1&per_page=100')
        .reply(401, { message: 'Authorization failed' });

      const res = await handler(lambdaRequest, context);
      assertLambdaResponse(res, 400, {
        error: 'Response code 401 (Unauthorized)',
      });
      assertNockDone();
    });

    it('should gracefully handle a failing github request', async () => {
      expect.hasAssertions();
      const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
        'pull_request/lambda_request',
      );
      const pipelinesReply = loadFixture('pull_request/buildkite/pipelines');

      nock('https://api.buildkite.com:443')
        .get('/v2/organizations/some-org/pipelines?page=1&per_page=100')
        .reply(200, pipelinesReply);

      nock('https://api.github.com')
        .get(
          `/repos/some-org/some-repo/contents/${encodeURIComponent(
            '.buildkite/pipeline/description/some-org',
          )}` + '?ref=c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffe',
        )
        .reply(401, {
          message: 'Bad credentials',
          documentation_url: 'https://developer.github.com/v3',
        });

      const res = await handler(lambdaRequest, context);
      assertLambdaResponse(res, 401, {
        error: 'Bad credentials',
      });
      assertNockDone();
    });

    it('should retry on github server error', async () => {
      expect.hasAssertions();
      const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
        'pull_request/lambda_request',
      );
      const pipelinesReply = loadFixture('pull_request/buildkite/pipelines');

      nock('https://api.buildkite.com:443')
        .get('/v2/organizations/some-org/pipelines?page=1&per_page=100')
        .reply(200, pipelinesReply);

      nock('https://api.github.com')
        .get(
          `/repos/some-org/some-repo/contents/${encodeURIComponent(
            '.buildkite/pipeline/description/some-org',
          )}` + '?ref=c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffe',
        )
        .times(4)
        .reply(502, {
          message: 'Bad Gateway',
          documentation_url: 'https://developer.github.com/v3',
        });

      const retryOption = process.env.GITHUB_RETRY_FAILED_REQUESTS;
      process.env.GITHUB_RETRY_FAILED_REQUESTS = 'true';

      const res = await handler(lambdaRequest, context);
      assertLambdaResponse(res, 502, {
        error: 'Bad Gateway',
      });
      assertNockDone();

      process.env.GITHUB_RETRY_FAILED_REQUESTS = retryOption;
    }, 30000);

    it('should gracefully handle non-JSON responses', async () => {
      expect.hasAssertions();
      const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
        'pull_request/lambda_request',
      );

      nock('https://api.buildkite.com:443')
        .get('/v2/organizations/some-org/pipelines?page=1&per_page=100')
        .reply(200, 'This is no JSON', {
          'Content-Type': 'text/plain',
        });

      const res = await handler(lambdaRequest, context);
      assertLambdaResponse(res, 400, {
        error:
          'Unexpected token T in JSON at position 0 in "https://api.buildkite.com/v2/organizations/some-org/pipelines?page=1&per_page=100"',
      });
      assertNockDone();
    });

    it('should gracefully handle broken JSON responses', async () => {
      expect.hasAssertions();
      const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
        'pull_request_review_comment/lambda_request',
      );

      const body = 'This is no JSON';
      nock('https://api.github.com').get('/users/some-user').reply(200, body, {
        'Content-Type': 'application/json',
      });

      try {
        JSON.parse(body);
      } catch (e) {
        const res = await handler(lambdaRequest, context);
        assertLambdaResponse(res, 400, {
          error: `invalid json response body at https://api.github.com/users/some-user reason: ${e.message}`,
        });
        assertNockDone();
      }
    });

    describe('ping', () => {
      it('should properly handle a ping', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
          'ping/lambda_request',
        );
        const res = await handler(lambdaRequest, context);
        assertLambdaResponse(res, 200, {
          commented: false,
          success: true,
          triggered: false,
          message: 'Hooks working for some-org/test-repo',
        });
        assertNockDone();
      });

      it('should complain if the events set up are not enough', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
          'ping/lambda_request_no_events',
        );
        const res = await handler(lambdaRequest, context);
        assertLambdaResponse(res, 400, {
          error: 'Configure at least the delivery of issue comments',
        });
        assertNockDone();
      });
    });

    describe('pull_request', () => {
      it('should ignore when pull requests change state except when they are opened', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
          'pull_request/lambda_pr_assigned',
        );
        const res = await handler(lambdaRequest, context);
        assertLambdaResponse(res, 200, {
          success: true,
          triggered: false,
        });
        assertNockDone();
      });

      it('should not post a comment to github about the usage when no pipelines match', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
          'pull_request/lambda_request',
        );
        const pipelinesReply = loadFixture(
          'pull_request/buildkite/no_matching_pipelines',
        );

        nock('https://api.buildkite.com:443')
          .get('/v2/organizations/some-org/pipelines?page=1&per_page=100')
          .reply(200, pipelinesReply);

        const res = await handler(lambdaRequest, context);
        assertLambdaResponse(res, 200, {
          success: true,
          triggered: false,
          commented: false,
        });
        assertNockDone();
      });

      it('should post a comment to github about the usage when a pull request is opened', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
          'pull_request/lambda_request',
        );
        const pipelinesReply = loadFixture('pull_request/buildkite/pipelines');
        const createdCommentReply = loadFixture(
          'pull_request/github/comment_create',
        );
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const expectedCommentCreationBody = require(join(
          __dirname,
          './fixtures/pull_request/github/comment_create_body_expected',
        ));
        const docSomePipelineLite = loadFixture(
          'pull_request/github/doc_some_pipeline_lite',
        );

        nock('https://api.buildkite.com:443')
          .get('/v2/organizations/some-org/pipelines?page=1&per_page=100')
          .reply(200, pipelinesReply);

        nock('https://api.github.com')
          .post(
            '/repos/some-org/some-repo/issues/1111111/comments',
            expectedCommentCreationBody,
          )
          .reply(201, createdCommentReply);

        nock('https://api.github.com')
          .get(
            `/repos/some-org/some-repo/contents/${encodeURIComponent(
              '.buildkite/pipeline/description/some-org',
            )}` + '?ref=c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffe',
          )
          .reply(200, docSomePipelineLite);

        const res = await handler(lambdaRequest, context);
        assertLambdaResponse(res, 200, {
          success: true,
          triggered: false,
          commented: true,
          commentUrl:
            'https://github.com/some-org/some-repo/pull/1111111#issuecomment-280987786',
        });
        assertNockDone();
      });

      it('should page when there are more pages', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
          'pull_request/lambda_request',
        );
        const pipelinesReply = loadFixture('pull_request/buildkite/pipelines');
        const pipelinesReplyPage2 = loadFixture(
          'pull_request/buildkite/pipelines_page2',
        );

        nock('https://api.buildkite.com')
          .get('/v2/organizations/some-org/pipelines?page=1&per_page=100')
          .reply(200, pipelinesReply, {
            link:
              '<https://api.buildkite.com/v2/organizations/some-org/pipelines?page=2&per_page=100>; rel="next", <https://api.buildkite.com/v2/organizations/some-org/pipelines?page=2&per_page=100>; rel="last"',
          })
          .get('/v2/organizations/some-org/pipelines?page=2&per_page=100')
          .reply(200, pipelinesReplyPage2, {
            link:
              '<https://api.buildkite.com/v2/organizations/some-org/pipelines?page=1&per_page=100>; rel="prev", <https://api.buildkite.com/v2/organizations/some-org/pipelines?page=1&per_page=100>; rel="first"',
          });

        await handler(lambdaRequest, context);
        assertNockDone();
      });
    });

    describe('issue_comment', () => {
      it('should start a build when an issue comment requests it', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
          'issue_comment/lambda_request',
        );
        const usersReply = loadFixture('github/users_some-user');
        const pullRequestReply = loadFixture(
          'issue_comment/github/pull_request',
        );
        const buildkiteCreateBuildReply = loadFixture(
          'issue_comment/buildkite/create_build',
        );
        const expectedBuildkiteCreateBody = loadFixture<BuildkiteBuildRequest>(
          'issue_comment/buildkite/create_build_body_expected',
        );

        const updateCommentReply = loadFixture(
          'issue_comment/github/update_comment',
        );
        const expectedGithubUpdateCommentBody = loadFixture(
          'issue_comment/github/update_comment_body_expected',
        );

        nock('https://api.github.com')
          .get('/users/some-user')
          .reply(200, usersReply);

        nock('https://api.github.com')
          .get('/repos/some-org/some-repo/pulls/9500')
          .reply(200, pullRequestReply);

        nock('https://api.buildkite.com:443')
          .post(
            '/v2/organizations/some-org/pipelines/some-pipeline-lite/builds',
            expectedBuildkiteCreateBody,
          )
          .reply(201, buildkiteCreateBuildReply);

        nock('https://api.github.com')
          .patch(
            '/repos/some-org/some-repo/issues/comments/279928810',
            expectedGithubUpdateCommentBody,
          )
          .reply(200, updateCommentReply);

        const response: CommentsRequestData = {
          self: { login: 'xx' },
          comments: {
            pullRequest: {
              comments: {
                nodes: [
                  { id: 'A', viewerDidAuthor: true, isMinimized: true }, // minimized already, leave it alone
                  { id: 'B', viewerDidAuthor: true, isMinimized: false },
                  {
                    id: 'C',
                    viewerDidAuthor: false,
                    isMinimized: false,
                    editor: {
                      login: 'xx',
                    },
                  },
                  {
                    id: 'D',
                    viewerDidAuthor: false,
                    isMinimized: false,
                    editor: {
                      login: 'xy', // different editor
                    },
                  },
                ],
              },
            },
          },
        };
        nock('https://api.github.com')
          .post('/graphql', {
            query: commentsReq,
            variables: {
              repoName: 'some-repo',
              repoOwner: 'some-org',
              prNumber: 9500,
            },
          })
          .reply(200, { data: response });

        nock('https://api.github.com')
          .post('/graphql', {
            query: mutationReq,
            variables: { subjectId: 'B' },
          })
          .reply(200, { data: { clientMutationId: null } });
        nock('https://api.github.com')
          .post('/graphql', {
            query: mutationReq,
            variables: { subjectId: 'C' },
          })
          .reply(200, { data: { clientMutationId: null } });

        const res = await handler(lambdaRequest, context);
        assertLambdaResponse(res, 200, {
          success: true,
          triggered: true,
          commented: false,
          updatedCommentUrl:
            'https://github.com/some-org/some-repo/pull/9500#issuecomment-279928810',
        });
        assertNockDone();
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
        const expectedBuildkiteCreateBody = loadFixture<BuildkiteBuildRequest>(
          'issue_comment/buildkite/create_build_body_expected',
        );
        const updateCommentReply = loadFixture(
          'issue_comment/github/update_comment',
        );
        const expectedGithubUpdateCommentBodyMultiple = loadFixture(
          'issue_comment/github/update_comment_body_expected_multiple',
        );

        nock('https://api.github.com')
          .get('/users/some-user')
          .reply(200, usersReply);

        nock('https://api.github.com')
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

        nock('https://api.github.com')
          .patch(
            '/repos/some-org/some-repo/issues/comments/279928810',
            expectedGithubUpdateCommentBodyMultiple,
          )
          .reply(200, updateCommentReply);

        const response: CommentsRequestData = {
          self: { login: 'xx' },
          comments: {
            pullRequest: {
              comments: {
                nodes: [],
              },
            },
          },
        };
        nock('https://api.github.com')
          .post('/graphql')
          .reply(200, { data: response });

        const res = await handler(lambdaRequestMultiBuild, context);
        assertLambdaResponse(res, 200, {
          success: true,
          triggered: true,
          commented: false,
          updatedCommentUrl:
            'https://github.com/some-org/some-repo/pull/9500#issuecomment-279928810',
        });
        assertNockDone();
      });

      it('should start a build with environment variables when an issue comment requests it', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
          'issue_comment/lambda_request_with_ENV',
        );
        const usersReply = loadFixture('github/users_some-user');
        const pullRequestReply = loadFixture(
          'issue_comment/github/pull_request',
        );
        const buildkiteCreateBuildReply = loadFixture(
          'issue_comment/buildkite/create_build',
        );
        const expectedBuildkiteCreateBody = loadFixture<BuildkiteBuildRequest>(
          'issue_comment/buildkite/create_build_body_expected_with_ENV',
        );
        const updateCommentReply = loadFixture(
          'issue_comment/github/update_comment_with_ENV',
        );
        const expectedGithubUpdateCommentBody = loadFixture(
          'issue_comment/github/update_comment_body_expected_with_ENV',
        );

        nock('https://api.github.com')
          .get('/users/some-user')
          .reply(200, usersReply);

        nock('https://api.github.com')
          .get('/repos/some-org/some-repo/pulls/9500')
          .reply(200, pullRequestReply);

        nock('https://api.buildkite.com:443')
          .post(
            '/v2/organizations/some-org/pipelines/some-pipeline-lite/builds',
            expectedBuildkiteCreateBody,
          )
          .reply(201, buildkiteCreateBuildReply);

        nock('https://api.github.com')
          .patch(
            '/repos/some-org/some-repo/issues/comments/279928810',
            expectedGithubUpdateCommentBody,
          )
          .reply(200, updateCommentReply);

        const response: CommentsRequestData = {
          self: { login: 'xx' },
          comments: {
            pullRequest: {
              comments: {
                nodes: [],
              },
            },
          },
        };
        nock('https://api.github.com')
          .post('/graphql')
          .reply(200, { data: response });

        const res = await handler(lambdaRequest, context);
        assertLambdaResponse(res, 200, {
          success: true,
          triggered: true,
          commented: false,
          updatedCommentUrl:
            'https://github.com/some-org/some-repo/pull/9500#issuecomment-279928810',
        });
        assertNockDone();
      });

      it('should ignore deleted comments', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
          'issue_comment/lambda_request_comment_deleted',
        );

        const res = await handler(lambdaRequest, context);
        assertLambdaResponse(res, 200, {
          success: true,
          triggered: false,
        });
        assertNockDone();
      });

      it('should ignore comments not attached to pull requests', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
          'issue_comment/lambda_request_no_pr',
        );

        const res = await handler(lambdaRequest, context);
        assertLambdaResponse(res, 200, {
          success: true,
          triggered: false,
        });
        assertNockDone();
      });

      it('should post a warning if the comment looks similar to a command', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
          'issue_comment/lambda_request_match_preamble',
        );
        const createCommentReply = loadFixture(
          'issue_comment/github/create_comment_warning',
        );
        const expectedGithubCreateCommentBody = loadFixture(
          'issue_comment/github/create_comment_body_expected_warning',
        );

        nock('https://api.github.com')
          .post(
            '/repos/some-org/some-repo/issues/9500/comments',
            expectedGithubCreateCommentBody,
          )
          .reply(200, createCommentReply);

        const res = await handler(lambdaRequest, context);
        assertLambdaResponse(res, 200, {
          success: true,
          triggered: false,
          commented: true,
          commentUrl:
            'https://github.com/some-org/some-repo/pull/1111111#issuecomment-280987786',
        });
        assertNockDone();
      });

      it('should not post a warning if the comment has a rocket emoji', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
          'issue_comment/lambda_request_has_emoji',
        );

        const res = await handler(lambdaRequest, context);
        assertLambdaResponse(res, 200, {
          success: true,
          triggered: false,
        });
        assertNockDone();
      });
    });

    describe('pull_request_review_comment', () => {
      it('should start a build when a pull request review comment requests it', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
          'pull_request_review_comment/lambda_request',
        );
        const usersReply = loadFixture('github/users_some-user');
        const buildkiteCreateBuildReply = loadFixture(
          'pull_request_review_comment/buildkite/create_build',
        );
        const buildkiteCreateBuildExpectedBody = loadFixture<BuildkiteBuildRequest>(
          'pull_request_review_comment/buildkite/create_build_body_expected',
        );
        const updateCommentReply = loadFixture(
          'pull_request_review_comment/github/update_comment',
        );
        const expectedGuithubUpdateCommentBody = loadFixture(
          'pull_request_review_comment/github/update_comment_body_expected',
        );

        nock('https://api.github.com')
          .get('/users/some-user')
          .reply(200, usersReply);

        nock('https://api.buildkite.com:443')
          .post(
            '/v2/organizations/some-org/pipelines/some-pipeline-lite/builds',
            buildkiteCreateBuildExpectedBody,
          )
          .reply(201, buildkiteCreateBuildReply);

        nock('https://api.github.com')
          .patch(
            '/repos/some-org/some-repo/pulls/comments/101434594',
            expectedGuithubUpdateCommentBody,
          )
          .reply(200, updateCommentReply);

        const response: CommentsRequestData = {
          self: { login: 'xx' },
          comments: {
            pullRequest: {
              comments: {
                nodes: [],
              },
            },
          },
        };
        nock('https://api.github.com')
          .post('/graphql')
          .reply(200, { data: response });

        const res = await handler(lambdaRequest, context);
        assertLambdaResponse(res, 200, {
          success: true,
          triggered: true,
          commented: false,
          updatedCommentUrl:
            'https://github.com/some-org/some-repo/pull/1111111#discussion_r101434594',
        });
        assertNockDone();
      });

      it('should ignore comments that do not contain a build marker', async () => {
        expect.hasAssertions();
        const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
          'pull_request_review_comment/lambda_request_random_comment',
        );

        const res = await handler(lambdaRequest, context);
        assertLambdaResponse(res, 200, {
          success: true,
          triggered: false,
        });
        assertNockDone();
      });

      describe('signature verification', () => {
        // eslint-disable-next-line jest/no-hooks
        beforeEach(() => {
          process.env[GITHUB_WEBHOOK_SECRET_KEY] =
            process.env[GITHUB_WEBHOOK_SECRET_KEY] || 'xxx';
        });

        // eslint-disable-next-line jest/no-hooks
        afterEach(() => {
          delete process.env[GITHUB_WEBHOOK_SECRET_KEY];
        });

        it('fails on incorrect signatures', async () => {
          expect.hasAssertions();
          const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
            'issue_comment/lambda_request_no_pr',
          );
          lambdaRequest.headers['X-Hub-Signature-256'] = 'invalid';
          lambdaRequest.headers['X-Hub-Signature'] = 'invalid';

          const res = await handler(lambdaRequest, context);
          assertLambdaResponse(res, 400, {
            error: 'Invalid signature',
          });
          assertNockDone();
        });

        it('passes on correct signatures', async () => {
          expect.hasAssertions();
          const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
            'issue_comment/lambda_request_no_pr',
          );

          const secret = process.env[GITHUB_WEBHOOK_SECRET_KEY];
          ok(secret);
          ok(lambdaRequest.body);
          lambdaRequest.headers['X-Hub-Signature-256'] = await sign(
            {
              secret,
              algorithm: 'sha256',
            },
            lambdaRequest.body,
          );
          lambdaRequest.headers['X-Hub-Signature'] = await sign(
            {
              secret,
              algorithm: 'sha1',
            },
            lambdaRequest.body,
          );
          const res = await handler(lambdaRequest, context);

          assertLambdaResponse(res, 200, { success: true, triggered: false });
          assertNockDone();
        });

        it('falls back to SHA1', async () => {
          expect.hasAssertions();
          const lambdaRequest = loadFixture<APIGatewayProxyEvent>(
            'issue_comment/lambda_request_no_pr',
          );

          const secret = process.env[GITHUB_WEBHOOK_SECRET_KEY];
          ok(secret);
          ok(lambdaRequest.body);
          delete lambdaRequest.headers['X-Hub-Signature-256'];
          lambdaRequest.headers['X-Hub-Signature'] = await sign(
            {
              secret,
              algorithm: 'sha1',
            },
            lambdaRequest.body,
          );
          const res = await handler(lambdaRequest, context);

          assertLambdaResponse(res, 200, { success: true, triggered: false });
          assertNockDone();
        });
      });
    });
  });
});
