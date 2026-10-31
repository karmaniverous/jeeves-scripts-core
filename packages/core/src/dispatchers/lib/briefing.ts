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

import { absolutePathSchema } from '../../config/absolute-path.js';
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

/**
 * The value of `eodSource` / `marketIntelSource` (what the morning
 * briefing reads) when that report has no directory configured.
 */
export const BRIEFING_NOT_ENABLED = 'not enabled';

const text = z.string().trim().min(1);

/**
 * The values a caller gives for a briefing template's placeholders. Every
 * directory is absolute. `eodDir` and `marketIntelDir` are optional: the
 * morning briefing reads them through `eodSource` / `marketIntelSource`
 * ({@link BRIEFING_NOT_ENABLED} when unset), while the end-of-day and
 * market-intel templates use their own directory as `{{eodDir}}` /
 * `{{marketIntelDir}}`, so running either without it fails the run
 * (`task template needs a value for {{eodDir}}`), never writing to a
 * made-up path.
 */
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
  /** The morning briefing's directory. */
  briefingDir: absolutePathSchema('briefingDir'),
  /** The end-of-day list's directory; required to run the end-of-day template. */
  eodDir: absolutePathSchema('eodDir').optional(),
  /** The market intel directory; required to run the market-intel template. */
  marketIntelDir: absolutePathSchema('marketIntelDir').optional(),
});

/** Briefing values as given (before the derived `eodSource` / `marketIntelSource`). */
export type BriefingVarsInput = z.input<typeof briefingVarsSchema>;

/**
 * Filled-in placeholder values: the given ones (an unset directory left
 * out), plus `eodSource` and `marketIntelSource` (the directory, or
 * {@link BRIEFING_NOT_ENABLED}).
 */
export type BriefingVars = Readonly<Record<string, string>>;

/**
 * Validate briefing template values, for `dispatchTaskFile`'s
 * `templateVars`.
 *
 * @throws Error listing every invalid field.
 */
export const briefingVars = (input: BriefingVarsInput): BriefingVars => {
  const parsed = briefingVarsSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(
      `Invalid briefing values: ${z.prettifyError(parsed.error)}`,
    );
  const { eodDir, marketIntelDir, ...given } = parsed.data;
  return {
    ...given,
    ...(eodDir === undefined ? {} : { eodDir }),
    ...(marketIntelDir === undefined ? {} : { marketIntelDir }),
    eodSource: eodDir ?? BRIEFING_NOT_ENABLED,
    marketIntelSource: marketIntelDir ?? BRIEFING_NOT_ENABLED,
  };
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
