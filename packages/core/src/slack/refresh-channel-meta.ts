/**
 * @module slack/refresh-channel-meta
 *
 * Daily upkeep of the Slack channels the bot is a member of, in every
 * gateway Slack account's workspace (each channel read and updated with
 * its own workspace's bot; DMs and MPIMs are out of scope). Generic: every
 * instance value comes from the `slack.channelMeta` config block (spec
 * 2.6, #49; the table is guides/slack.md).
 *
 * **Home-directory sweep (script).** Finds human posts that assign a
 * channel's home directory (by default "seed meta" and "home directory",
 * plus a path; `channel-meta/sweep`, `channel-meta/paths`) in core's Slack
 * archive (every silo's `slack/` directory), else `conversations.history`,
 * reading only messages newer than the last run. The latest assignment
 * per channel wins; bot posts never count. It never writes the instance
 * config (Decision 66): for each new assignment the report gives the
 * exact command to run from the instance repo,
 * `node bin/jeeves-scripts.js config set slack.channels.<id>.homeDir '<path>'`
 * (`channel-meta/proposal-command`), plus mismatches with the config and
 * assigned paths that don't exist.
 *
 * **Descriptions and topics (worker writes, script applies).** For
 * channels with a home directory and a seeded meta (`channel-meta/plan`):
 * a description (Slack purpose) from the meta and a topic from the meta
 * and the channel's recent messages, generated when empty, never
 * generated before, or stale. ONE worker per run gets a snapshot of up to
 * `maxChannels` channels and writes `result.json` without touching Slack;
 * the script checks every value, sets it and re-reads it
 * (`channel-meta/worker-batch`, `channel-meta/apply`).
 *
 * **Report (script).** The full report goes to `<outputDir>/<YYYY-MM-DD>.md`
 * (the date in `timezone`; `lib/dated-report`) and a numbers-only summary
 * with the report's jeeves-server insider link (`lib/server-link`, the key
 * from `@karmaniverous/jeeves`' `computeInsiderKey` over the server's
 * `serverKey` seed) goes to `reportChannel`, by default the OpenClaw
 * command owner's DM. Generated text stays in its workspace
 * (`channel-meta/text-scope`). An unchanged report is neither written nor
 * posted again.
 *
 * **Config.** No `slack.channelMeta` block: the run skips. A
 * present block is validated by `config check` (Decision 76); what only
 * the run can know (the OpenClaw owner when `reportChannel` is unset,
 * directories absolute on this host) fails the run and is reported by
 * `doctor`. State and run directories: `{stateDir}/slack/channel-meta/`.
 *
 * **Flags.** Without `--live` the run does the whole read-only pass,
 * dispatches the worker for real (one AI session, the batch a live run
 * would take) and writes the report, each proposed value beside the
 * current one, to `preview.md` in the run directory, setting, delivering,
 * posting and saving nothing. `--live` sets the values, writes the dated
 * report and posts the summary. `--print-task` only prints the worker's
 * TASK and logs the summary and the report.
 *
 * **Manifest.** `jobs/slack.json`, daily, shipped disabled with no
 * arguments (a dry run); the enabling delta adds `--live`.
 */

import { argFlag } from '@karmaniverous/jeeves';

import { defineRunnable } from '../runnables/define-runnable.js';
import {
  JOB_ID,
  liveRefreshDeps,
  liveSettings,
  NO_BLOCK,
} from './channel-meta/live.js';
import { refreshChannelMeta, SCRIPT_NAME } from './channel-meta/refresh.js';

/** The runnable's flags. */
export const refreshChannelMetaFlags = {
  live: argFlag(
    '--live',
    'Set descriptions and topics, write the report and post the summary (default: dry run)',
  ),
  printTask: argFlag('--print-task', "Print the worker's TASK; set nothing"),
};

export default defineRunnable({
  id: JOB_ID,
  domain: 'slack',
  name: SCRIPT_NAME,
  description:
    'Sweep Slack channels for home-directory assignments, refresh descriptions and topics from each channel\u2019s meta, write a dated report and post a summary with its link.',
  flags: refreshChannelMetaFlags,
  prerequisite: () => (liveSettings() === undefined ? NO_BLOCK : true),
  doctorCheck: () => {
    const settings = liveSettings();
    return settings !== undefined && 'problem' in settings
      ? settings.problem
      : true;
  },
  run: async ({ flags }) => {
    if (liveSettings() === undefined) {
      console.log(`[skip] ${NO_BLOCK}`);
      return;
    }
    const outcome = await refreshChannelMeta(flags, liveRefreshDeps());
    if (outcome === 'partial') process.exitCode = 1;
  },
});
