/**
 * @module admin/skill-review/settings
 *
 * The review's settings from the validated `skillReview` block
 * (`config/skill-review-schema`, which applies every default and checks
 * every key's type and bounds, so `config check` reports a broken block),
 * plus what only the run can know: the report directory when `outputDir`
 * is unset (the report channel's `slack.channels.<id>.homeDir`), whether
 * `reportAccount` names a gateway Slack account, and whether the
 * directory is absolute on this host. A problem is returned as
 * `{ problem }`, naming the key; a run then fails (Decision 76) and
 * `doctor` reports it. Pure apart from the injected readers.
 */

import { defaultReportDir } from '../../config/report-target.js';
import {
  SKILL_REVIEW_BLOCK,
  skillReviewAccountProblem,
  type SkillReviewBlock,
} from '../../config/skill-review-schema.js';

/** The resolved settings. */
export interface SkillReviewSettings {
  /** Slack conversation id for the summary and the quiet-day alert. */
  reportChannel: string;
  /** Gateway Slack account whose bot posts. */
  reportAccount: string;
  /** Absolute directory for `<YYYY-MM-DD>.md` reports. */
  outputDir: string;
  /** Where `outputDir` came from. */
  outputDirSource: 'config' | 'homeDir';
  /** IANA time zone. */
  timeZone: string;
  /** jeeves-server machine key name. */
  serverKeyName: string;
  /** Quiet-day budget alert threshold, percent of the character budget. */
  budgetAlertPercent: number;
}

/** What the run adds to the block (live: `slack.channels`, OpenClaw's bot tokens, `node:path`). */
export interface SettingsDeps {
  /** A channel's configured `homeDir`. */
  channelHomeDir: (channelId: string) => string | undefined;
  /** The gateway Slack accounts. */
  slackAccounts: () => readonly string[];
  /** Whether a path is absolute on this host. */
  isAbsolute: (p: string) => boolean;
}

/** `dir` with its source, or the problem when it isn't absolute on this host. */
const onHost = (
  dir: string,
  key: string,
  source: SkillReviewSettings['outputDirSource'],
  deps: SettingsDeps,
): Pick<SkillReviewSettings, 'outputDir' | 'outputDirSource'> | string =>
  deps.isAbsolute(dir)
    ? { outputDir: dir, outputDirSource: source }
    : `${key} must be absolute on this host: ${dir}`;

/** The report directory: `outputDir`, else the report channel's `homeDir`. */
const reportDir = (
  block: SkillReviewBlock,
  deps: SettingsDeps,
): Pick<SkillReviewSettings, 'outputDir' | 'outputDirSource'> | string => {
  if (block.outputDir !== undefined)
    return onHost(
      block.outputDir,
      `${SKILL_REVIEW_BLOCK}.outputDir`,
      'config',
      deps,
    );
  // The config check applies the same rule (Decision 76).
  const dir = defaultReportDir(
    block.reportChannel,
    deps.channelHomeDir,
    SKILL_REVIEW_BLOCK,
  );
  return 'problem' in dir
    ? dir.problem
    : onHost(
        dir.homeDir,
        `slack.channels.${block.reportChannel}.homeDir`,
        'homeDir',
        deps,
      );
};

/**
 * Resolve the settings.
 *
 * @param block - The validated `skillReview` block.
 * @param deps - Run-time readers.
 * @returns The settings, or the reason they are incomplete.
 */
export function resolveSettings(
  block: SkillReviewBlock,
  deps: SettingsDeps,
): SkillReviewSettings | { problem: string } {
  // The config check applies the same rule (Decision 76).
  const account = skillReviewAccountProblem(block, deps.slackAccounts);
  if (account !== undefined) return { problem: account };
  const dir = reportDir(block, deps);
  if (typeof dir === 'string') return { problem: dir };
  return {
    reportChannel: block.reportChannel,
    reportAccount: block.reportAccount,
    ...dir,
    timeZone: block.timezone,
    serverKeyName: block.serverKey,
    budgetAlertPercent: block.budgetAlertPercent,
  };
}
