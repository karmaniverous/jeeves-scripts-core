/**
 * @module poll-mentions
 *
 * Polls mentions via X API v2 for every handle in X_ACCOUNTS, or only the
 * handle given as the first argument.
 *
 * Entry-point script invoked by the runner scheduler. Delegates to
 * poll-x-items with the pollUserMentions API function, enqueuing results
 * into the x-mentions-\{handle\} runner queue for drain-queues to flush to disk.
 */

import { defineJob } from '../jobs/define-job.js';
import { pollXFlags, runXPoller } from './lib/poll-x-items.js';
import { xJobDeps } from './lib/x-deps.js';
import { pollUserMentions } from './lib/x-timelines.js';

export default defineJob({
  id: 'x-poll-mentions',
  domain: 'x',
  name: 'x/poll-mentions',
  flags: pollXFlags,
  positionals: '[handle]',
  run: ({ args, flags }) =>
    runXPoller(
      args,
      flags,
      {
        pollFn: pollUserMentions,
        queuePrefix: 'x-mentions',
        typeLabel: 'mentions',
      },
      xJobDeps(),
    ),
});
