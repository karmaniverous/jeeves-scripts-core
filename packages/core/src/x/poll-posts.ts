/**
 * @module poll-posts
 *
 * Polls each account's own posts via X API v2: every handle in
 * X_ACCOUNTS, or only the handle given as the first argument.
 *
 * Entry-point script invoked by the runner scheduler. Delegates to
 * poll-x-items with the pollUserTweets API function, enqueuing results
 * into the x-posts-\{handle\} runner queue for drain-queues to flush to disk.
 */

import { defineJob } from '../jobs/define-job.js';
import { runXPoller } from './lib/poll-x-items.js';
import { xJobDeps } from './lib/x-deps.js';
import { pollUserTweets } from './lib/x-timelines.js';

export default defineJob({
  id: 'x-poll-posts',
  domain: 'x',
  name: 'x/poll-posts',
  run: ({ args }) =>
    runXPoller(
      args,
      {
        pollFn: pollUserTweets,
        queuePrefix: 'x-posts',
        typeLabel: 'posts',
      },
      xJobDeps(),
    ),
});
