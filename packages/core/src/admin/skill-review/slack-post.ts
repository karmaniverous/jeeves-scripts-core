/**
 * @module admin/skill-review/slack-post
 *
 * Build the Slack summary from the validated report: the job applied
 * nothing (every proposal is still pending), the report's insider link,
 * then every reviewed proposal in one numbered list grouped by
 * disposition (continuous numbers, so the operator can reply "apply all
 * recommendations except #5"), and proposals discovered after the review
 * ran, grouped as not yet reviewed; then the skills catalog budget lines
 * (`skill-review/catalog-budget-render`). Slack mrkdwn (single-asterisk bold,
 * `<url|label>` links). The script builds this, not the model: every
 * field but the report's own prose comes from data the script already
 * gathered. Pure.
 */

import { escapeSlack } from '../../lib/slack-text.js';
import type { PendingProposal } from './proposals.js';
import type { Reconciled } from './reconcile.js';
import {
  type Disposition,
  DISPOSITION_LABELS,
  type ValidReport,
} from './report.js';

/** A proposal's identity, as gathered (never from the model). */
export type ReviewedProposal = Pick<
  PendingProposal,
  'id' | 'skillName' | 'kind'
>;

const NOT_YET_REVIEWED = 'Not yet reviewed';

interface PostLine {
  skillName: string;
  kind: string;
  shortDescription: string;
  recommendation: string;
}

/** `create` reads as "new"; any other kind is an update. */
const kindLabel = (kind: string): string =>
  kind === 'create' ? 'new' : 'update';

const withPeriod = (s: string): string => {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

/** Report prose is shown, never acted on (`<!channel>`, `<@U123>`). */
const esc = escapeSlack;

/**
 * Build the Slack post.
 *
 * @param report - The validated report (disposition, short description,
 *   recommendation per reviewed proposal id).
 * @param state - The reviewed proposals reconciled with the Workshop at
 *   posting time (`skill-review/reconcile`).
 * @param reportLink - The report's Slack mrkdwn link (`lib/server-link`).
 * @param budgetLines - The skills catalog budget, Slack mrkdwn lines.
 * @returns The post text.
 * @throws Error when the report has no entry for a reviewed proposal
 *   (validation guarantees one, so this is a broken invariant).
 */
export function buildReviewPost(
  report: ValidReport,
  state: Reconciled,
  reportLink: string,
  budgetLines: readonly string[],
): string {
  const bySection = new Map<string, PostLine[]>();
  const push = (section: string, line: PostLine): void => {
    const list = bySection.get(section) ?? [];
    list.push(line);
    bySection.set(section, list);
  };

  for (const p of state.current) {
    const entry = report.entries[p.id];
    if (!entry) throw new Error(`The report has no entry for ${p.id}`);
    const section: string =
      entry.disposition === 'Not reviewed'
        ? NOT_YET_REVIEWED
        : entry.disposition;
    push(section, {
      skillName: p.skillName,
      kind: p.kind,
      shortDescription: entry.shortDescription,
      recommendation: entry.recommendation,
    });
  }
  for (const p of state.revised) {
    push(NOT_YET_REVIEWED, {
      skillName: p.skillName,
      kind: p.kind,
      shortDescription: 'Revised after this review ran.',
      recommendation:
        "The report's recommendation is for the earlier draft; it will be re-reviewed next run.",
    });
  }
  for (const p of state.added) {
    push(NOT_YET_REVIEWED, {
      skillName: p.skillName,
      kind: p.kind,
      shortDescription: 'Proposed after this review ran.',
      recommendation: 'Not yet reviewed; it will be covered next run.',
    });
  }

  const sections: readonly string[] = [
    ...DISPOSITION_LABELS.filter((d): d is Disposition => d !== 'Not reviewed'),
    NOT_YET_REVIEWED,
  ];

  let n = 0;
  const body: string[] = [];
  for (const section of sections) {
    const lines = bySection.get(section);
    if (!lines) continue;
    body.push(`*${section}*`);
    for (const line of lines) {
      n += 1;
      body.push(
        `${String(n)}. \`${esc(line.skillName)}\` (${kindLabel(line.kind)}): ${withPeriod(esc(line.shortDescription))} ${withPeriod(esc(line.recommendation))}`,
      );
    }
    body.push('');
  }

  const lines = [
    '*This job applied nothing. Every proposal below is still pending, awaiting your decision.*',
    ...(state.snapshot
      ? [
          "_Couldn't fully re-check the Workshop before posting; this reflects the review's snapshot._",
        ]
      : []),
    ...(state.decided > 0
      ? [
          `_${String(state.decided)} reviewed proposal(s) decided since the review ran are omitted._`,
        ]
      : []),
    `Report: ${reportLink}`,
    '',
    ...body,
    ...budgetLines,
    '',
    'Reply with something like "apply all recommendations except #5" to tell me what to do.',
  ];
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
