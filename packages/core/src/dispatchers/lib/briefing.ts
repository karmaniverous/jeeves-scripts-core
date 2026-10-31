/**
 * @module dispatchers/lib/briefing
 *
 * The executive daily-briefing family (#33): core's three TASK templates
 * (morning briefing, end-of-day follow-up, market intel; each its own
 * dispatcher, enabled separately), the values their placeholders take
 * ({@link briefingVarsSchema}), and the Slack summary shape as job-script
 * config ({@link briefingSummaryPurpose}), not worker instructions. Pass
 * them to `dispatchTaskFile` (`template`, `templateVars`, `slack`); an
 * instance file at the dispatcher's `taskFile` path wins over the core
 * template (Decision 75). Pure.
 */

import { z } from 'zod';

import { isTimeZone } from '../../lib/dates.js';

/** Core's briefing TASK templates, by report (names under `task-templates/`). */
export const BRIEFING_TEMPLATES = {
  /** The morning action-item briefing (internal). */
  morning: 'daily-briefings/morning-briefing.md',
  /** The end-of-day follow-up (internal). */
  eod: 'daily-briefings/eod-follow-up.md',
  /** Market intel (shareable outside the organisation). */
  marketIntel: 'daily-briefings/market-intel.md',
} as const;

/** The value of `eodDir` / `marketIntelDir` when that report is not enabled. */
export const BRIEFING_NOT_ENABLED = 'not enabled';

const text = z.string().trim().min(1);

/** The values a briefing template's placeholders take. */
export const briefingVarsSchema = z.object({
  /** The organisation, e.g. `Acme`. */
  org: text,
  /** The executive the briefing serves. */
  principal: text,
  /** The people the principal hands work to, e.g. `Ana (ops), Ben (finance)`. */
  delegates: text,
  /** The principal's IANA time zone (the dispatcher's `dateTimeZone` too). */
  timeZone: text.refine(isTimeZone, {
    message: 'timeZone must be an IANA time zone',
  }),
  /** The delivery (and feedback) channel as the worker sees it, e.g. `#ceo-briefing`. */
  deliveryChannel: text,
  /** The morning briefing's directory (absolute). */
  briefingDir: text,
  /** The end-of-day list's directory; default {@link BRIEFING_NOT_ENABLED}. */
  eodDir: text.default(BRIEFING_NOT_ENABLED),
  /** The market intel directory; default {@link BRIEFING_NOT_ENABLED}. */
  marketIntelDir: text.default(BRIEFING_NOT_ENABLED),
});

/** Briefing template values (defaults applied). */
export type BriefingVars = z.infer<typeof briefingVarsSchema>;

/**
 * Validate briefing template values, for `dispatchTaskFile`'s
 * `templateVars`.
 *
 * @throws Error listing every invalid field.
 */
export const briefingVars = (input: z.input<typeof briefingVarsSchema>) => {
  const parsed = briefingVarsSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(
      `Invalid briefing values: ${z.prettifyError(parsed.error)}`,
    );
  return parsed.data;
};

/** The Slack summary shape for one report. */
export interface BriefingSummaryShape {
  /** The leading emoji, e.g. `📋`. */
  emoji: string;
  /** The title, e.g. `Acme CEO Daily Briefing`. */
  title: string;
  /** What the bullets hold; default `3-5 BLUF bullets`. */
  bullets?: string;
}

/**
 * A post target's `purpose` that fixes the summary's shape: the emoji
 * and bold title with today's date, the bullets, then the link to the
 * full document, never the document itself.
 */
export const briefingSummaryPurpose = ({
  emoji,
  title,
  bullets = '3-5 BLUF bullets',
}: BriefingSummaryShape): string =>
  `the ${title} summary, never the full document. Exactly: the line "${emoji} *${title} — YYYY-MM-DD*", a blank line, ${bullets} as "• " lines with *bold* key phrases, a blank line, then the jeeves-server link to today's full report.`;
