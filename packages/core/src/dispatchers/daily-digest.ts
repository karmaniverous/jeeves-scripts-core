/**
 * @module dispatchers/daily-digest
 *
 * Dispatcher: Generate Daily Digest (job `generate-daily-digest`).
 *
 * Reads the standing-order task `digest/TASK.md` in the default silo
 * (override with `jobs.generate-daily-digest.silo` / `.taskFile` in
 * `jeeves-scripts.json`) and dispatches a worker session to execute it,
 * through the task-file dispatcher. No task file: `[skip]`.
 *
 * Slack is handled by this script, not the worker (OpenClaw 2026.9 workers
 * have no Slack tool): posts the TASK asks for come back in a
 * `slack-posts` block and the script posts them (see lib/worker-slack).
 * The worker may post only to the configured targets. `--dry-run` prints
 * the posts instead; `--print-task` prints the TASK.
 *
 * The TASK is prefixed with today's date in the ref `digest.timezone`
 * (IANA name, e.g. `America/Chicago`, or `UTC`). There is no default: once
 * the task file exists, a missing or invalid zone fails the run.
 *
 * Config (`pipeline.refs` in `jeeves-scripts.json`):
 * - `digest.timezone` (required once the task file exists)
 * - `slack.digestChannel` (channel the digest is published to) and
 *   `slack.operatorDm` (user/DM for the completion summary), both
 *   optional. With neither set, the worker can't post to Slack.
 */

import { digestTargets } from './lib/digest-targets.js';
import { digestTimeZone } from './lib/digest-timezone.js';
import { taskFileDispatcher } from './lib/task-file-dispatcher.js';

taskFileDispatcher({
  scriptName: 'dispatchers/daily-digest',
  jobId: 'generate-daily-digest',
  thinking: 'low',
  taskFile: 'digest/TASK.md',
  dateTimeZone: digestTimeZone,
  slack: () => ({ posts: digestTargets() }),
});
