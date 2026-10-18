/**
 * @module poll-likes
 *
 * Polls liked tweets via X API v2 for every handle in X_ACCOUNTS, or only the
 * handle given as the first argument.
 *
 * Entry-point script invoked by the runner scheduler. Delegates to
 * poll-x-items with the pollLikedTweets API function, enqueuing results
 * into the x-likes-\{handle\} runner queue for drain-queues to flush to disk.
 */

import { defineJob } from '../jobs/define-job.js';
import { pollXFlags, runXPoller } from './lib/poll-x-items.js';
import { xJobDeps } from './lib/x-deps.js';
import { pollLikedTweets } from './lib/x-timelines.js';

export default defineJob({
  id: 'x-poll-likes',
  domain: 'x',
  name: 'x/poll-likes',
  flags: pollXFlags,
  positionals: '[handle]',
  run: ({ args, flags }) =>
    runXPoller(
      args,
      flags,
      {
        pollFn: pollLikedTweets,
        queuePrefix: 'x-likes',
        typeLabel: 'likes',
      },
      xJobDeps(),
    ),
});
