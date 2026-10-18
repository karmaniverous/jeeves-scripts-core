/**
 * @module linear/sync-issues
 *
 * Polling sync for Linear issues (scheduled runner job, every 23 minutes,
 * `jobs/linear.json`): upserts every issue updated since the cursor in
 * runner state (`linear` / `sync-issues-cursor`) into `{silo}/linear/issue`
 * with reverse-diff history, then advances the cursor
 * (`linear/lib/linear-sync`). Run by hand: `jeeves-scripts run linear-sync-issues`.
 */

import { defineJob } from '../jobs/define-job.js';
import { linearJobDeps, syncLinear } from './lib/linear-sync.js';

export default defineJob({
  id: 'linear-sync-issues',
  domain: 'linear',
  flags: {},
  name: 'linear/sync-issues',
  run: () => syncLinear('issue', linearJobDeps()),
});
