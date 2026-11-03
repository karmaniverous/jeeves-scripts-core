/**
 * @module admin/skill-review/catalog-budget-render
 *
 * The skills catalog budget (`skill-review/catalog-budget`) in words: a short
 * Slack section for the review post (usage against the character budget,
 * the format, long descriptions and the longest few, names
 * Slack-escaped), a fuller Markdown section appended to the delivered
 * report, and the quiet-day alert (only when the catalog is near its
 * budget or already cut). A budget that couldn't be measured reads
 * "unavailable" in the post and the report. Pure.
 */

import { escapeSlack } from '../../slack/channel-meta/slack-text.js';
import type { CatalogBudget, LongDescription } from './catalog-budget.js';
import { COMPACT_DESCRIPTION_MAX_CHARS } from './catalog-format.js';
import { DESCRIPTION_MAX_BYTES } from './checks.js';

/** A measured budget, or why it couldn't be measured. */
export type BudgetResult = CatalogBudget | { problem: string };

/** Longest descriptions named in the Slack post. */
export const LONGEST_IN_SLACK = 3;

const n = (value: number): string => value.toLocaleString('en-US');

/**
 * The share used, one decimal, rounded away from 100% (down within the
 * budget, up over it) so only a catalog exactly at the budget reads
 * 100.0% (the epsilon absorbs float error like 94.99999999999999), in
 * tenths of a percent.
 */
const usedTenths = (b: CatalogBudget): number =>
  b.headroom >= 0
    ? Math.floor(b.usedPct * 10 + 1e-9)
    : Math.ceil(b.usedPct * 10 - 1e-9);

const tenthsText = (tenths: number): string => `${(tenths / 10).toFixed(1)}%`;

const usedText = (b: CatalogBudget): string => tenthsText(usedTenths(b));

const formatText = (b: CatalogBudget): string =>
  b.format.kind === 'full'
    ? 'full format'
    : b.format.descriptionMaxChars > 0
      ? `COMPACT format (descriptions cut to ${n(b.format.descriptionMaxChars)} chars)`
      : 'COMPACT format (descriptions omitted)';

const spareText = (b: CatalogBudget): string =>
  b.headroom >= 0
    ? `${n(b.headroom)} chars (${tenthsText(1000 - usedTenths(b))}) to spare`
    : `${n(-b.headroom)} chars over`;

const truncatedText = (b: CatalogBudget): string =>
  b.included < b.skills
    ? ` Only ${n(b.included)} of ${n(b.skills)} skills are listed.`
    : '';

const longText = (b: CatalogBudget): string =>
  `${n(b.longCount)} description(s) over ${String(DESCRIPTION_MAX_BYTES)} bytes, ${n(b.longExcess)} bytes over in all`;

const limitSourceText = (b: CatalogBudget): string =>
  b.maxCharsSource === 'agent'
    ? `agent \`${b.agentId}\` \`skillsLimits.maxSkillsPromptChars\``
    : b.maxCharsSource === 'skills.limits'
      ? '`skills.limits.maxSkillsPromptChars`'
      : "OpenClaw's default";

/**
 * The Slack section.
 *
 * @param budget - The budget, or why it couldn't be measured.
 * @returns Lines of Slack mrkdwn.
 */
export function budgetSlackLines(budget: BudgetResult): string[] {
  if ('problem' in budget)
    return ['*Skills catalog budget:* unavailable (see the job log).'];
  const longest = budget.longest
    .slice(0, LONGEST_IN_SLACK)
    .map(
      (d) =>
        `\`${escapeSlack(d.name)}\` ${n(d.bytes)} bytes (${escapeSlack(d.owner)})`,
    )
    .join(', ');
  return [
    `*Skills catalog budget:* ${n(budget.chars)} / ${n(budget.maxChars)} chars (${usedText(budget)}), ${formatText(budget)}; ${spareText(budget)}.${truncatedText(budget)}`,
    budget.longCount > 0
      ? `${longText(budget)}; longest: ${longest}.`
      : `No description over ${String(DESCRIPTION_MAX_BYTES)} bytes.`,
  ];
}

const CAP_ADVICE =
  'Raise `skills.limits.maxSkillsInPrompt` or retire skills so every skill is listed.';

/** Why a quiet-day alert is due, `undefined` when none is. */
const alertReason = (
  b: CatalogBudget,
  alertPercent: number,
): [reason: string, advice: string] | undefined => {
  if (b.format.kind === 'compact')
    return [
      'the skills catalog is already in the COMPACT format',
      `Shorten the longest descriptions or raise the character budget to restore the full format.${b.maxSkills < b.skills ? ` ${CAP_ADVICE}` : ''}`,
    ];
  if (b.included < b.skills)
    return [
      'the skill count cap already leaves skills out of the catalog',
      CAP_ADVICE,
    ];
  if (usedTenths(b) >= alertPercent * 10)
    return [
      `the skills catalog uses ${usedText(b)} of its character budget (alert at ${String(alertPercent)}%)`,
      'Shorten the longest descriptions or raise the character budget before OpenClaw switches the catalog to the compact format.',
    ];
  return undefined;
};

/**
 * The quiet-day alert: posted when nothing is pending but the catalog
 * uses at least `alertPercent` of its character budget (as the post
 * shows it, one decimal rounded away from 100%) or is already cut
 * (compact format, or skills left out by the count cap).
 *
 * @param budget - The measured budget.
 * @param alertPercent - The threshold, percent of the character budget.
 * @returns The post text, `undefined` when no alert is due.
 */
export function budgetAlertPost(
  budget: CatalogBudget,
  alertPercent: number,
): string | undefined {
  const due = alertReason(budget, alertPercent);
  if (due === undefined) return undefined;
  const [reason, advice] = due;
  return [
    `*Skills catalog alert:* no Workshop proposals are pending today, but ${reason}.`,
    ...budgetSlackLines(budget),
    advice,
  ].join('\n');
}

/** What `chars` measured: every skill, or the count cap's first few. */
const fullCatalogText = (b: CatalogBudget): string =>
  b.maxSkills < b.skills
    ? `${n(b.chars)} chars: the first ${n(b.maxSkills)} of ${n(b.skills)} model-visible skills (the count cap) and the truncation note`
    : `${n(b.chars)} chars, ${n(b.skills)} model-visible skills`;

const longestRow = (d: LongDescription): string =>
  `| \`${d.name}\` | ${n(d.bytes)} | ${d.owner} |`;

/** How exact the measure is (shown in the report). */
export const BUDGET_MARGIN_NOTE =
  "The catalog is rebuilt from the gateway's `skills.status` with OpenClaw's own formatter, so the count is exact (0 chars off) when the job and the gateway resolve the same home directory, OpenClaw's config directory is under the OS home and no remote-node note or skill location note is in play; otherwise each affected skill path or note adds or removes a few dozen chars. It measures the catalog new sessions get: a running session keeps the one it started with.";

/**
 * The report section.
 *
 * @param budget - The budget, or why it couldn't be measured.
 * @returns Markdown, starting with its `##` heading.
 */
export function budgetReportSection(budget: BudgetResult): string {
  const heading = '## Skills catalog budget';
  if ('problem' in budget)
    return `${heading}\n\nUnavailable: ${budget.problem}\n`;
  const b = budget;
  const rows: [string, string][] = [
    ['Full catalog', fullCatalogText(b)],
    ['Character budget', `${n(b.maxChars)} (${limitSourceText(b)})`],
    ['Used', `${usedText(b)}; ${spareText(b)}`],
    ['Format in force', formatText(b)],
    [
      'Skills listed',
      `${n(b.included)} of ${n(b.skills)} (cap ${n(b.maxSkills)})`,
    ],
    ['Long descriptions', longText(b)],
    [
      'Token share',
      `descriptions are also cut when the catalog exceeds a fifth of the model context in tokens: the full catalog fits models with ${n(b.minContextTokens)}+ tokens`,
    ],
  ];
  const lines = [
    heading,
    '',
    `Agent \`${b.agentId}\`. When the full catalog exceeds the character budget, OpenClaw switches the whole catalog to the compact format (descriptions cut to at most ${String(COMPACT_DESCRIPTION_MAX_CHARS)} chars).`,
    '',
    '| Measure | Value |',
    '| --- | --- |',
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
  ];
  if (b.longest.length > 0)
    lines.push(
      '',
      '**Longest descriptions**',
      '',
      '| Skill | Bytes | Owner |',
      '| --- | --- | --- |',
      ...b.longest.map(longestRow),
    );
  lines.push('', BUDGET_MARGIN_NOTE);
  return `${lines.join('\n')}\n`;
}
