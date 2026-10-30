/**
 * @module poll-bookmarks
 *
 * Polls bookmarks via X API v2 for every handle in X_ACCOUNTS, or only the
 * handle given as the first argument.
 *
 * Entry-point script invoked by the runner scheduler. Delegates to
 * poll-x-items with the pollBookmarks API function, enqueuing results
 * into the x-bookmarks-\{handle\} runner queue for drain-queues to flush to disk.
 */

import { defineRunnable } from '../runnables/define-runnable.js';
import { pollXFlags, runXPoller } from './lib/poll-x-items.js';
import { xJobDeps } from './lib/x-deps.js';
import { pollBookmarks } from './lib/x-timelines.js';

export default defineRunnable({
  id: 'x-poll-bookmarks',
  domain: 'x',
  name: 'x/poll-bookmarks',
  flags: pollXFlags,
  positionals: '[handle]',
  run: ({ args, flags }) =>
    runXPoller(
      args,
      flags,
      {
        pollFn: pollBookmarks,
        queuePrefix: 'x-bookmarks',
        typeLabel: 'bookmarks',
      },
      xJobDeps(),
    ),
});
