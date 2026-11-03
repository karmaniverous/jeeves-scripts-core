/**
 * @module admin/skill-review/task
 *
 * The worker's TASK, built at runtime: read the snapshot, judge every
 * pending proposal against the whole inventory, write the report to the
 * run directory in the exact format {@link validateReport} checks, and
 * stop. The worker only reports: it never posts to Slack (the script
 * builds the Slack summary itself from the validated report; see
 * `skill-review/slack-post`).
 */

import { withDateContext } from '../../lib/dates.js';
import { DESCRIPTION_MAX_BYTES } from './checks.js';
import { DISPOSITION_LABELS } from './report.js';

/** What the TASK names. */
export interface TaskInput {
  /** Snapshot `INDEX.md`. */
  indexFile: string;
  /** The run directory. */
  runDir: string;
  /** Where the worker writes its report. */
  reportFile: string;
  /** Where the script will deliver the report (named in the summary). */
  deliveredReport: string;
  /** Pending proposal ids, in review order. */
  proposalIds: readonly string[];
  /** The run's instant. */
  now: Date;
  /** IANA zone for the date line. */
  timeZone: string;
}

/**
 * Build the TASK.
 *
 * @param input - Paths, proposals, date.
 * @returns The TASK text (before core appends the Slack contract).
 */
export function buildTask(input: TaskInput): string {
  const ids = input.proposalIds.map((id) => `- \`${id}\``).join('\n');
  const dispositions = DISPOSITION_LABELS.join(' | ');
  const maxBytes = String(DESCRIPTION_MAX_BYTES);
  const task = `# Daily Skill Workshop proposal review

You review the pending Skill Workshop proposals and report. **You only report.** Never call the \`skill_workshop\` tool, never apply, reject, revise or quarantine a proposal, never post to Slack, and never create, edit or delete any file except the one report file named below.

## Inputs

- Snapshot index: \`${input.indexFile}\`. Read it first: every pending proposal with the script's mechanical checks, and the full skill inventory (name, origin, size, description, snapshot file).
- Run directory: \`${input.runDir}\`. \`proposals/<id>/\` holds each draft (\`PROPOSAL.md\`, support files) and \`LIVE-SKILL.md\` (the live skill an update targets). \`inventory/<origin>/<name>.md\` holds every live skill's SKILL.md.

Origins: \`workshop\` = this instance's own Workshop skills; \`jeeves\`, \`jeeves-tools\`, \`jeeves-scripts-core\` = skills shipped by those packages (shared by every instance); \`openclaw-bundled\` = shipped with OpenClaw; \`plugin\` = installed by an OpenClaw plugin; \`local\` = hand-installed on this host. A package-owned skill (anything but \`workshop\` and \`local\`) is never changed through a Workshop draft.

Pending proposals (${String(input.proposalIds.length)}):

${ids}

## For each proposal

1. Read the draft, its support files and, for an update, \`LIVE-SKILL.md\`. Read every inventory skill whose name, description or subject overlaps it.
2. Write a one-line **short description** of what the proposal does (plain language, no jargon — this goes straight to Slack).
3. Decide a **disposition**, exactly one of: ${dispositions}.
   - **Approve as is**: apply it unchanged.
   - **Approve with modifications**: apply it, but say exactly what to change in the recommendation (including a hoist: the procedure is instance-independent and belongs in a shared skill — name the target package, \`jeeves\`, \`jeeves-tools\` or \`jeeves-scripts-core\`, new or existing, and what to generalize: host paths, ids, people, instance names).
   - **Reject or decline**: say why in the recommendation: duplicate (of what), one-off record (belongs in memory or files), superseded (by what), wrong home (where it belongs), or another concrete reason.
   - **Not reviewed**: you ran out of room to judge it this run; say so in the recommendation.
4. Write a one-line **recommendation**: exactly what the operator should do next. This is the line that goes to Slack next to the short description, so make it stand on its own.
5. Note any **flags**, when true: revert risk (the draft would revert content or the description that is newer in the live skill — the index says whether the live skill changed after the draft was created), description too long (over ${maxBytes} bytes; the index gives the byte count), \`child_process\` (a support script uses it; the Workshop scanner quarantines it), duplicate drafts (several pending drafts for the same skill; recommend which to keep or how to consolidate).

## Report

Write the whole report, in Markdown, to \`${input.reportFile}\` (overwrite it if it exists). Use exactly this structure:

\`\`\`\`markdown
# Skill Workshop review

## Summary

<one short paragraph: counts per disposition and anything urgent>

## Proposals

### <proposal id>

**Skill:** <skill name> (<create | update>)

**Disposition:** <${dispositions}>

**Short description:** <one line, plain language>

**Recommendation:** <one line, stands alone>

**Flags:** <revert risk, description too long, child_process, duplicate drafts; or "none">
\`\`\`\`

One \`### <proposal id>\` section per proposal above, headed with the exact id, each with \`**Disposition:**\`, \`**Short description:**\` and \`**Recommendation:**\` lines. The job fails if a section or any of those three lines is missing. The report is delivered to \`${input.deliveredReport}\`; the script posts the Slack summary from it, so write these three lines as if they will be read verbatim in Slack.`;
  return withDateContext(task, input.now, input.timeZone);
}
