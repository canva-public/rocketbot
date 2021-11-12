import type {
  IssueCommentEvent,
  Repository,
  WebhookEvent,
  WebhookEventName,
} from '@octokit/webhooks-types';
import { Octokit } from '@octokit/rest';
import type { RestEndpointMethodTypes } from '@octokit/rest';
import type { Logger } from 'pino';

type PullRequestData = RestEndpointMethodTypes['pulls']['get']['response']['data'];
type IssueCommentData = RestEndpointMethodTypes['issues']['updateComment']['response']['data'];
type PullRequestReviewCommentData = RestEndpointMethodTypes['pulls']['updateReviewComment']['response']['data'];

/**
 * Retrieves details about a pull request
 */
export async function githubGetPullRequestDetails(
  octokit: Octokit,
  repository: Repository,
  pullNumber: number,
): Promise<PullRequestData> {
  return (
    await octokit.pulls.get({
      owner: repository.owner.login,
      repo: repository.name,
      pull_number: pullNumber,
    })
  ).data;
}

/**
 * Adds a comment to a given comment thread on a pull request
 */
export async function githubAddComment(
  octokit: Octokit,
  logger: Logger,
  repository: Repository,
  issueNumber: number,
  body: string,
): Promise<
  RestEndpointMethodTypes['issues']['createComment']['response']['data']
> {
  logger.debug('adding comment to %s#%s', repository.full_name, issueNumber);
  return (
    await octokit.issues.createComment({
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: issueNumber,
      body,
    })
  ).data;
}

/**
 * Updates a Github comment
 */
export async function githubUpdateComment(
  octokit: Octokit,
  eventName: 'pull_request_review_comment' | 'issue_comment',
  repository: Repository,
  commentId: number,
  body: string,
): Promise<IssueCommentData | PullRequestReviewCommentData> {
  const payload = {
    body,
    comment_id: commentId,
    owner: repository.owner.login,
    repo: repository.name,
  };
  if (eventName == 'pull_request_review_comment') {
    return (await octokit.pulls.updateReviewComment(payload)).data;
  } else {
    return (await octokit.issues.updateComment(payload)).data;
  }
}

/**
 * Type guard for issue comments
 */
export function isIssueComment(
  eventName: WebhookEventName,
  event: WebhookEvent,
): event is IssueCommentEvent {
  return eventName === 'issue_comment';
}
