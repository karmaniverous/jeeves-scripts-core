/**
 * @module admin/review-skill-proposals
 *
 * Daily review of every pending OpenClaw Skill Workshop proposal (spec
 * 2.11, #70; the guide is guides/admin.md). One report-only worker judges
 * each proposal against the whole installed skill inventory; the script
 * gathers, delivers the report and builds and posts the Slack summary.
 * Nothing is ever applied, rejected or edited: every proposal stays
 * pending for a person. Generic: every instance value comes from the
 * `skillReview` config block.
 *
 * **Gather (script, no LLM).** Pending proposals through the gateway's
 * `skill_workshop` tool (`list`, then `inspect` each; artifact texts from
 * the Workshop store, hash-checked; `skill-review/proposals`) and the
 * skill inventory from disk (every agent's Workshop skills,
 * `skills.load.extraDirs`, OpenClaw's managed and plugin skills, the
 * workspace skills and OpenClaw's bundled skills, each labelled with its
 * origin; `skill-review/inventory`), plus the mechanical checks
 * (description over 160 chars, a Jeeves convention for catalog size,
 * not an OpenClaw limit; support files using
 * `child_process`, duplicate drafts, a live skill changed after the
 * draft; `skill-review/checks`), written to a snapshot in
 * `{stateDir}/admin/skill-review/runs/<YYYYMMDD-HHMMSS>/` (the newest 14
 * kept). Fifty listed (the tool's maximum): a `[warn]`; the rest wait.
 *
 * **Review (worker).** The worker reads the snapshot and writes only its
 * report in the run directory: one `### <id>` section per proposal with a
 * disposition, a short description and a recommendation
 * (`skill-review/task`, `skill-review/report`). It is dispatched with no
 * Slack post targets and never calls `skill_workshop`.
 *
 * **Deliver and post (script).** The report's insider link is resolved
 * before the worker runs (`lib/server-link`, the key from `serverKey`); a
 * live run the server can't link fails there. The validated report, plus
 * a `## Skills catalog budget` section, goes to
 * `<outputDir>/<YYYY-MM-DD>.md` (the date in `timezone`); the Workshop is
 * re-gathered (`skill-review/reconcile`) and the script-built summary
 * (`skill-review/slack-post`) is posted to `reportChannel` as
 * `reportAccount`'s bot: nothing applied, the link, every proposal in one
 * numbered list grouped by disposition (each line with its proposal id),
 * then the catalog budget lines.
 *
 * **Catalog budget (script).** The gateway's `skills.status` rebuilt with
 * OpenClaw 2026.9.6's `<available_skills>` formatter and fitted to its
 * character budget (`skill-review/catalog-*`). A quiet day (nothing
 * pending) posts only an alert, and only when the catalog uses at least
 * `budgetAlertPercent` of its budget or is already cut.
 *
 * **Config.** No loadable instance config, or no `skillReview` block: the
 * run skips (exit 0). A present block is validated by `config check`, its
 * posting account included (Decision 76); an invalid one fails the run;
 * what only the run can know (directories absolute on this host) fails
 * the run and is reported by `doctor`.
 *
 * **Flags.** Without `--live` the run gathers and writes the snapshot
 * (read-only elsewhere), measures the budget, resolves the link (warning
 * on failure) and logs what it would dispatch, deliver and post; it starts
 * no worker. `--live` dispatches the worker, delivers the report and
 * posts. `--print-task` prints the TASK and delivers and posts nothing.
 *
 * **Manifest.** `jobs/admin.json`, daily, shipped disabled with no
 * arguments (a dry run); the enabling delta adds `--live`.
 */

import { argFlag } from '@karmaniverous/jeeves';

import { defineRunnable } from '../runnables/define-runnable.js';
import { JOB_ID, liveReviewDeps, liveSettings } from './skill-review/live.js';
import { reviewWorkshop, SCRIPT_NAME } from './skill-review/review.js';

/** The runnable's flags. */
export const reviewSkillProposalsFlags = {
  live: argFlag(
    '--live',
    'Dispatch the reviewer, deliver the report and post the summary (default: dry run)',
  ),
  printTask: argFlag(
    '--print-task',
    "Print the reviewer's TASK; deliver and post nothing",
  ),
};

export default defineRunnable({
  id: JOB_ID,
  domain: 'admin',
  name: SCRIPT_NAME,
  description:
    'Review pending Skill Workshop proposals against the skill inventory, write a dated report and post a numbered summary with its link; applies nothing.',
  flags: reviewSkillProposalsFlags,
  prerequisite: () => {
    const settings = liveSettings();
    return 'skip' in settings ? settings.skip : true;
  },
  doctorCheck: () => {
    const settings = liveSettings();
    return 'problem' in settings ? settings.problem : true;
  },
  run: async ({ flags }) => {
    const settings = liveSettings();
    if ('skip' in settings) {
      console.log(`[skip] ${settings.skip}`);
      return;
    }
    await reviewWorkshop(flags, liveReviewDeps());
  },
});
