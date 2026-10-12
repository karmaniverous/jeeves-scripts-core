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

import { defineJob } from '../jobs/define-job.js';
import { linearJobDeps, syncLinear } from './lib/linear-sync.js';

export default defineJob({
  id: 'linear-sync-comments',
  domain: 'linear',
  name: 'linear/sync-comments',
  run: () => syncLinear('comment', linearJobDeps()),
});
