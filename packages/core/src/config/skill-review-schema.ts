/**
 * @module config/skill-review-schema
 *
 * The top-level `skillReview` block of `admin-review-skill-proposals`
 * (spec 2.11, #70): where the review's summary goes, the bot that posts
 * it, the report's zone, directory and jeeves-server machine key, and the
 * quiet-day budget alert threshold. The whole block is optional (absent:
 * the runnable skips); a present block that is invalid fails
 * `config check` and every run (Decision 76). The report directory rule
 * ({@link skillReviewReportDirIssue}, which needs `slack.channels`) is
 * checked on the whole config by `config/schema`, so this schema has no
 * refinement and `.pick()`/`.omit()` work on it; the posting account is
 * checked against the gateway by `config/check` and the run
 * ({@link skillReviewAccountProblem}).
 */

import { z } from 'zod';

import { isTimeZone } from '../lib/dates.js';
import { absolutePathSchema } from './absolute-path.js';
import { defaultReportDir, unknownSlackAccounts } from './report-target.js';

/** Where the block lives, for messages. */
export const SKILL_REVIEW_BLOCK = 'skillReview';

/** The quiet-day alert threshold when `budgetAlertPercent` is unset. */
export const DEFAULT_BUDGET_ALERT_PERCENT = 90;

/** The `skillReview` block (spec 2.11; the table is guides/config.md). */
export const skillReviewSchema = z.strictObject({
  /** Slack conversation the summary and the quiet-day alert go to. */
  reportChannel: z
    .string()
    .regex(
      /^[CGD][A-Z0-9]{2,}$/,
      'reportChannel must be a Slack conversation id (C…, G… or D…)',
    ),
  /** Gateway Slack account whose bot posts (default `default`). */
  reportAccount: z.string().trim().min(1).default('default'),
  /** IANA zone of the report date (no default). */
  timezone: z
    .string()
    .refine(isTimeZone, { message: 'timezone must be an IANA time zone' }),
  /** jeeves-server machine key (in the server's own `keys`) that resolves the report's insider link. */
  serverKey: z.string().trim().min(1),
  /** Report directory; default `slack.channels.<reportChannel>.homeDir`, required for a DM or a channel without one. */
  outputDir: absolutePathSchema('outputDir').optional(),
  /** Quiet-day alert threshold, percent of the catalog's character budget. */
  budgetAlertPercent: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(DEFAULT_BUDGET_ALERT_PERCENT),
});

/** The `skillReview` block (defaults applied). */
export type SkillReviewBlock = z.infer<typeof skillReviewSchema>;

/** The parts of a parsed config {@link skillReviewReportDirIssue} reads. */
interface ReportDirConfig {
  /** The `slack` block's per-channel decisions. */
  slack: { channels: Readonly<Record<string, { homeDir?: string }>> };
  /** The `skillReview` block, if any. */
  skillReview?: SkillReviewBlock;
}

/**
 * The report directory rule on a parsed config, for the config check: a
 * `skillReview` block with no `outputDir` whose report channel has no
 * `homeDir` (`config/report-target` `defaultReportDir`, as the run
 * applies it).
 *
 * @param config - The parsed config.
 * @returns The issue's path and message, or `undefined`.
 */
export function skillReviewReportDirIssue(
  config: ReportDirConfig,
): { path: string[]; message: string } | undefined {
  const block = config.skillReview;
  if (block === undefined || block.outputDir !== undefined) return undefined;
  const dir = defaultReportDir(
    block.reportChannel,
    (id) => config.slack.channels[id]?.homeDir,
    SKILL_REVIEW_BLOCK,
  );
  return 'problem' in dir
    ? { path: [SKILL_REVIEW_BLOCK, 'outputDir'], message: dir.problem }
    : undefined;
}

/**
 * Whether `reportAccount` names a gateway Slack account, written once for
 * the config check (`config/check`) and the run
 * (`admin/skill-review/settings`, so `doctor` reports it too).
 *
 * @param block - The block's account key.
 * @param accounts - The gateway Slack accounts.
 * @returns The problem, or `undefined`.
 */
export const skillReviewAccountProblem = (
  block: Pick<SkillReviewBlock, 'reportAccount'>,
  accounts: () => readonly string[],
): string | undefined =>
  unknownSlackAccounts(
    SKILL_REVIEW_BLOCK,
    [['reportAccount', block.reportAccount]],
    accounts,
  );
