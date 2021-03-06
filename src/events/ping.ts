import { PingEvent, WebhookEventName } from '@octokit/webhooks-types';
import { JSONResponse } from '../response';

const issueCommentEventName: WebhookEventName = 'issue_comment';

export function ping(event: PingEvent): JSONResponse {
  if (
    !event.hook.active ||
    !event.hook.events ||
    !event.hook.events.includes(issueCommentEventName)
  ) {
    throw new Error('Configure at least the delivery of issue comments');
  }
  const repository = event.repository?.full_name ?? 'unknown repository';

  return {
    success: true,
    triggered: false,
    commented: false,
    message: `Hooks working for ${repository}`,
  };
}
