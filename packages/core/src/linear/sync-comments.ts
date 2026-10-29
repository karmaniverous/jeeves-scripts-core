/**
 * @module linear/sync-comments
 *
 * Polling sync for Linear comments (scheduled runner job, every 29 minutes,
 * `jobs/linear.json`): upserts every comment updated since the cursor in
 * runner state (`linear` / `sync-comments-cursor`) into
 * `{silo}/linear/comment` with reverse-diff history, then advances the
 * cursor (`linear/lib/linear-sync`). Run by hand:
 * `jeeves-scripts run linear-sync-comments`.
 */

import { defineRunnable } from '../runnables/define-runnable.js';
import { linearJobDeps, syncLinear } from './lib/linear-sync.js';

export default defineRunnable({
  id: 'linear-sync-comments',
  domain: 'linear',
  flags: {},
  name: 'linear/sync-comments',
  run: () => syncLinear('comment', linearJobDeps()),
});
