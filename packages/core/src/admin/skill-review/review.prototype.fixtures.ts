/**
 * The prototype's outputs on the scenarios of `review.prototype.test`:
 * the review flow of the instance prototype this runnable was hoisted
 * from, run on the same inputs, with the documented renames applied (the
 * crash label `admin/review-skill-proposals`) and the one departure:
 * each numbered post line names its proposal id ("(new, id p-1)"), which
 * the prototype left out (owner, 2026-11-03). Paths are
 * `<root>` (the test's temp root) and `<run>` (the run id). Generated
 * once by running both implementations side by side; regenerate only
 * with a reviewed reason.
 */

/** One scenario's observable result. */
export interface PrototypeOutput {
  /** What `reviewWorkshop` resolved to, or the message it threw. */
  outcome: string | { threw: string };
  /** The delivered report file, or `null`. */
  delivered: string | null;
  /** The texts posted to Slack. */
  posts: string[];
  /** The log lines. */
  lines: string[];
  /** The flags each worker dispatch got. */
  dispatched: { dryRun: boolean; printTask: boolean }[];
}

/** The prototype's outputs, by scenario name. */
export const PROTOTYPE_OUTPUTS: Record<string, PrototypeOutput> = {
  'live, four proposals, measured budget': {
    outcome: 'delivered',
    delivered:
      "### p-1\n\n**Disposition:** Approve as is\n\n**Short description:** short <p-1> & *bold*\n\n**Recommendation:** do the thing for p-1 @here\n\n### p-2\n\n**Disposition:** Approve with modifications\n\n**Short description:** short <p-2> & *bold*\n\n**Recommendation:** do the thing for p-2 @here\n\n### p-3\n\n**Disposition:** Reject or decline\n\n**Short description:** short <p-3> & *bold*\n\n**Recommendation:** do the thing for p-3 @here\n\n### p-4\n\n**Disposition:** Not reviewed\n\n**Short description:** short <p-4> & *bold*\n\n**Recommendation:** do the thing for p-4 @here\n\n## Skills catalog budget\n\nAgent `main`. When the full catalog exceeds the character budget, OpenClaw switches the whole catalog to the compact format (descriptions cut to at most 220 chars).\n\n| Measure | Value |\n| --- | --- |\n| Full catalog | 2,507 chars, 11 model-visible skills |\n| Character budget | 18,000 (OpenClaw's default) |\n| Used | 13.9%; 15,493 chars (86.1%) to spare |\n| Format in force | full format |\n| Skills listed | 11 of 11 (cap 150) |\n| Long descriptions | 2 description(s) over 160 chars, 320 chars over in all |\n| Token share | descriptions are also cut when the catalog exceeds a fifth of the model context in tokens: the full catalog fits models with 12,535+ tokens |\n\n**Longest descriptions**\n\n| Skill | Chars | Owner |\n| --- | --- | --- |\n| `s05` | 400 | jeeves |\n| `s03` | 240 | jeeves |\n\nThe catalog is rebuilt from the gateway's `skills.status` with OpenClaw's own formatter, so the count is exact (0 chars off) when the job and the gateway resolve the same home directory, OpenClaw's config directory is under the OS home and no remote-node note or skill location note is in play; otherwise each affected skill path or note adds or removes a few dozen chars. It measures the catalog new sessions get: a running session keeps the one it started with.\n",
    posts: [
      '*This job applied nothing. Every proposal below is still pending, awaiting your decision.*\nReport: <link:2026-10-20.md>\n\n*Approve as is*\n1. `skill-p-1` (new, id `p-1`): short &lt;p-1&gt; &amp; *bold*. do the thing for p-1 @here.\n\n*Approve with modifications*\n2. `skill-p-2` (new, id `p-2`): short &lt;p-2&gt; &amp; *bold*. do the thing for p-2 @here.\n\n*Reject or decline*\n3. `skill-p-3` (new, id `p-3`): short &lt;p-3&gt; &amp; *bold*. do the thing for p-3 @here.\n\n*Not yet reviewed*\n4. `skill-p-4` (new, id `p-4`): short &lt;p-4&gt; &amp; *bold*. do the thing for p-4 @here.\n\n*Skills catalog budget:* 2,507 / 18,000 chars (13.9%), full format; 15,493 chars (86.1%) to spare.\n2 description(s) over 160 chars, 320 chars over in all; longest: `s05` 400 (jeeves), `s03` 240 (jeeves).\n\nReply with something like "apply all recommendations except #5" to tell me what to do.',
    ],
    lines: [
      'admin/review-skill-proposals: 4 pending proposal(s), 0 skill(s); snapshot <root>/runs/<run>',
      'admin/review-skill-proposals: report <root>/out/2026-10-20.md: 1 approve as is, 1 approve with modifications, 1 reject, 1 not yet reviewed, 0 decided since; Slack post sent',
    ],
    dispatched: [{ dryRun: false, printTask: false }],
  },
  'live, re-gather changed': {
    outcome: 'delivered',
    delivered:
      "### p-1\n\n**Disposition:** Approve as is\n\n**Short description:** short <p-1> & *bold*\n\n**Recommendation:** do the thing for p-1 @here\n\n### p-2\n\n**Disposition:** Approve with modifications\n\n**Short description:** short <p-2> & *bold*\n\n**Recommendation:** do the thing for p-2 @here\n\n### p-3\n\n**Disposition:** Reject or decline\n\n**Short description:** short <p-3> & *bold*\n\n**Recommendation:** do the thing for p-3 @here\n\n## Skills catalog budget\n\nAgent `main`. When the full catalog exceeds the character budget, OpenClaw switches the whole catalog to the compact format (descriptions cut to at most 220 chars).\n\n| Measure | Value |\n| --- | --- |\n| Full catalog | 2,507 chars, 11 model-visible skills |\n| Character budget | 18,000 (OpenClaw's default) |\n| Used | 13.9%; 15,493 chars (86.1%) to spare |\n| Format in force | full format |\n| Skills listed | 11 of 11 (cap 150) |\n| Long descriptions | 2 description(s) over 160 chars, 320 chars over in all |\n| Token share | descriptions are also cut when the catalog exceeds a fifth of the model context in tokens: the full catalog fits models with 12,535+ tokens |\n\n**Longest descriptions**\n\n| Skill | Chars | Owner |\n| --- | --- | --- |\n| `s05` | 400 | jeeves |\n| `s03` | 240 | jeeves |\n\nThe catalog is rebuilt from the gateway's `skills.status` with OpenClaw's own formatter, so the count is exact (0 chars off) when the job and the gateway resolve the same home directory, OpenClaw's config directory is under the OS home and no remote-node note or skill location note is in play; otherwise each affected skill path or note adds or removes a few dozen chars. It measures the catalog new sessions get: a running session keeps the one it started with.\n",
    posts: [
      '*This job applied nothing. Every proposal below is still pending, awaiting your decision.*\n_1 reviewed proposal(s) decided since the review ran are omitted._\nReport: <link:2026-10-20.md>\n\n*Reject or decline*\n1. `skill-p-3` (new, id `p-3`): short &lt;p-3&gt; &amp; *bold*. do the thing for p-3 @here.\n\n*Not yet reviewed*\n2. `skill-p-2` (new, id `p-2`): Revised after this review ran. The report\'s recommendation is for the earlier draft; it will be re-reviewed next run.\n3. `skill-p-9` (new, id `p-9`): Proposed after this review ran. Not yet reviewed; it will be covered next run.\n\n*Skills catalog budget:* 2,507 / 18,000 chars (13.9%), full format; 15,493 chars (86.1%) to spare.\n2 description(s) over 160 chars, 320 chars over in all; longest: `s05` 400 (jeeves), `s03` 240 (jeeves).\n\nReply with something like "apply all recommendations except #5" to tell me what to do.',
    ],
    lines: [
      'admin/review-skill-proposals: 3 pending proposal(s), 0 skill(s); snapshot <root>/runs/<run>',
      'admin/review-skill-proposals: report <root>/out/2026-10-20.md: 1 approve as is, 1 approve with modifications, 1 reject, 2 not yet reviewed, 1 decided since; Slack post sent',
    ],
    dispatched: [{ dryRun: false, printTask: false }],
  },
  'live, re-gather fails, budget fails': {
    outcome: 'delivered',
    delivered:
      '### p-1\n\n**Disposition:** Approve as is\n\n**Short description:** short <p-1> & *bold*\n\n**Recommendation:** do the thing for p-1 @here\n\n### p-2\n\n**Disposition:** Approve with modifications\n\n**Short description:** short <p-2> & *bold*\n\n**Recommendation:** do the thing for p-2 @here\n\n## Skills catalog budget\n\nUnavailable: gateway closed\n',
    posts: [
      '*This job applied nothing. Every proposal below is still pending, awaiting your decision.*\n_Couldn\'t fully re-check the Workshop before posting; this reflects the review\'s snapshot._\nReport: <link:2026-10-20.md>\n\n*Approve as is*\n1. `skill-p-1` (new, id `p-1`): short &lt;p-1&gt; &amp; *bold*. do the thing for p-1 @here.\n\n*Approve with modifications*\n2. `skill-p-2` (new, id `p-2`): short &lt;p-2&gt; &amp; *bold*. do the thing for p-2 @here.\n\n*Skills catalog budget:* unavailable (see the job log).\n\nReply with something like "apply all recommendations except #5" to tell me what to do.',
    ],
    lines: [
      'admin/review-skill-proposals: 2 pending proposal(s), 0 skill(s); snapshot <root>/runs/<run>',
      '[warn] admin/review-skill-proposals: skills catalog budget unavailable: gateway closed',
      "[warn] admin/review-skill-proposals: couldn't re-check the Workshop before posting; posting the review's snapshot: gateway down",
      'admin/review-skill-proposals: report <root>/out/2026-10-20.md: 1 approve as is, 1 approve with modifications, 0 reject, 0 not yet reviewed, 0 decided since; Slack post sent',
    ],
    dispatched: [{ dryRun: false, printTask: false }],
  },
  'live, missing report': {
    outcome: {
      threw: 'The worker wrote no report at <root>/runs/<run>/report.md',
    },
    delivered: null,
    posts: [],
    lines: [
      'admin/review-skill-proposals: 1 pending proposal(s), 0 skill(s); snapshot <root>/runs/<run>',
    ],
    dispatched: [{ dryRun: false, printTask: false }],
  },
  'dry run': {
    outcome: 'previewed',
    delivered: null,
    posts: [],
    lines: [
      'admin/review-skill-proposals: 2 pending proposal(s), 0 skill(s); snapshot <root>/runs/<run>',
      'admin/review-skill-proposals: *Skills catalog budget:* 2,507 / 18,000 chars (13.9%), full format; 15,493 chars (86.1%) to spare.',
      'admin/review-skill-proposals: 2 description(s) over 160 chars, 320 chars over in all; longest: `s05` 400 (jeeves), `s03` 240 (jeeves).',
      'admin/review-skill-proposals: preview only; the report would go to <root>/out/2026-10-20.md (homeDir)',
    ],
    dispatched: [{ dryRun: true, printTask: false }],
  },
  'print task': {
    outcome: 'previewed',
    delivered: null,
    posts: [],
    lines: [
      'admin/review-skill-proposals: 1 pending proposal(s), 0 skill(s); snapshot <root>/runs/<run>',
      'admin/review-skill-proposals: *Skills catalog budget:* 2,507 / 18,000 chars (13.9%), full format; 15,493 chars (86.1%) to spare.',
      'admin/review-skill-proposals: 2 description(s) over 160 chars, 320 chars over in all; longest: `s05` 400 (jeeves), `s03` 240 (jeeves).',
      'admin/review-skill-proposals: preview only; the report would go to <root>/out/2026-10-20.md (homeDir)',
    ],
    dispatched: [{ dryRun: true, printTask: true }],
  },
  'quiet day under threshold': {
    outcome: 'skipped',
    delivered: null,
    posts: [],
    lines: [
      '[skip] admin/review-skill-proposals: no pending Workshop proposals',
      'admin/review-skill-proposals: skills catalog under 90% of its budget; no alert',
    ],
    dispatched: [],
  },
  'quiet day over threshold': {
    outcome: 'alerted',
    delivered: null,
    posts: [
      '*Skills catalog alert:* no Workshop proposals are pending today, but the skills catalog uses 96.4% of its character budget (alert at 90%).\n*Skills catalog budget:* 2,507 / 2,600 chars (96.4%), full format; 93 chars (3.6%) to spare.\n2 description(s) over 160 chars, 320 chars over in all; longest: `s05` 400 (jeeves), `s03` 240 (jeeves).\nShorten the longest descriptions or raise the character budget before OpenClaw switches the catalog to the compact format.',
    ],
    lines: [
      '[skip] admin/review-skill-proposals: no pending Workshop proposals',
      'admin/review-skill-proposals: skills catalog alert sent',
    ],
    dispatched: [],
  },
  'quiet day over threshold, dry run': {
    outcome: 'previewed',
    delivered: null,
    posts: [],
    lines: [
      '[skip] admin/review-skill-proposals: no pending Workshop proposals',
      'admin/review-skill-proposals: *Skills catalog alert:* no Workshop proposals are pending today, but the skills catalog uses 96.4% of its character budget (alert at 90%).',
      'admin/review-skill-proposals: *Skills catalog budget:* 2,507 / 2,600 chars (96.4%), full format; 93 chars (3.6%) to spare.',
      'admin/review-skill-proposals: 2 description(s) over 160 chars, 320 chars over in all; longest: `s05` 400 (jeeves), `s03` 240 (jeeves).',
      'admin/review-skill-proposals: Shorten the longest descriptions or raise the character budget before OpenClaw switches the catalog to the compact format.',
      'admin/review-skill-proposals: preview only; the alert above would go to C123',
    ],
    dispatched: [],
  },
  'quiet day, budget fails': {
    outcome: 'skipped',
    delivered: null,
    posts: [],
    lines: [
      '[skip] admin/review-skill-proposals: no pending Workshop proposals',
      '[warn] admin/review-skill-proposals: skills catalog budget unavailable: gateway closed',
    ],
    dispatched: [],
  },
};

/**
 * The first scenario with a multibyte description (120 two-byte chars:
 * under the limit in chars, over it in UTF-8 bytes): the prototype post.
 */
export const MULTIBYTE = {
  prototypePost:
    '*This job applied nothing. Every proposal below is still pending, awaiting your decision.*\nReport: <link:2026-10-20.md>\n\n*Approve as is*\n1. `skill-p-1` (new, id `p-1`): short &lt;p-1&gt; &amp; *bold*. do the thing for p-1 @here.\n\n*Approve with modifications*\n2. `skill-p-2` (new, id `p-2`): short &lt;p-2&gt; &amp; *bold*. do the thing for p-2 @here.\n\n*Reject or decline*\n3. `skill-p-3` (new, id `p-3`): short &lt;p-3&gt; &amp; *bold*. do the thing for p-3 @here.\n\n*Not yet reviewed*\n4. `skill-p-4` (new, id `p-4`): short &lt;p-4&gt; &amp; *bold*. do the thing for p-4 @here.\n\n*Skills catalog budget:* 2,387 / 18,000 chars (13.2%), full format; 15,613 chars (86.8%) to spare.\n1 description(s) over 160 chars, 240 chars over in all; longest: `s05` 400 (jeeves).\n\nReply with something like "apply all recommendations except #5" to tell me what to do.',
};
