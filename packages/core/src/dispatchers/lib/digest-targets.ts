/**
 * @module dispatchers/lib/digest-targets
 *
 * The Slack targets core's daily digest worker may post to, from the
 * `pipeline.refs` `slack.digestChannel` and `slack.operatorDm` (both
 * optional). Reads config; no other side effects.
 */

import { tryGetRef } from '../../config/pipeline-accessors.js';
import type { SlackPostTarget } from '../../lib/worker-slack/worker-slack-config.js';

/** Slack targets the digest worker may post to: the digest channel, then the operator DM, each only when set. */
export function digestTargets(): SlackPostTarget[] {
  const targets: SlackPostTarget[] = [];
  const channel = tryGetRef('slack.digestChannel');
  const operatorDm = tryGetRef('slack.operatorDm');
  if (channel)
    targets.push({ target: channel, purpose: 'the published daily digest' });
  if (operatorDm)
    targets.push({
      target: operatorDm,
      purpose: 'completion summary (operator DM)',
    });
  return targets;
}
