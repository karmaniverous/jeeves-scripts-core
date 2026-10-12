/**
 * @module repost
 *
 * Processes the repost queue by reposting tweets via X API v2.
 *
 * Entry-point script invoked by the runner scheduler. Dequeues tweet IDs
 * from the x-repost-\{handle\} runner queue and calls repostPost from x-api
 * for each one, reporting success and failure counts.
 */

import { defineJob } from '../jobs/define-job.js';
import { xQueueAction } from './lib/run-x-queue-action.js';
import { repostPost } from './lib/x-actions.js';

export default defineJob({
  id: 'x-repost',
  domain: 'x',
  description:
    "Repost the tweets queued in the account's x-repost-<handle> runner queue.",
  name: 'x/repost',
  ...xQueueAction({
    scriptName: 'x/repost',
    queuePrefix: 'x-repost',
    actionLabel: 'repost',
    successLabel: 'reposted',
    actionFn: repostPost,
  }),
});
