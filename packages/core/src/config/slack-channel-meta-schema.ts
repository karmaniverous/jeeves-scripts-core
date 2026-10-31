/**
 * @module config/slack-channel-meta-schema
 *
 * The `slack.channelMeta` block of `slack-refresh-channel-meta` (spec
 * 2.6, #49): every key, its default and its bounds, and the report
 * directory rule ({@link defaultReportDir}, which needs `slack.channels`,
 * so `config/schema` checks it on the whole config and the schemas stay
 * free of refinements: `.pick()` and `.omit()` work on them).
 * `config/slack-schema` puts the block in the `slack` block and
 * re-exports the schema and its type; the helpers here stay off the root
 * export.
 */

import { z } from 'zod';

import { isTimeZone } from '../lib/dates.js';
import { absolutePathSchema } from './absolute-path.js';
import { slackChannelIdSchema } from './slack-channel-id.js';

/** Slack's own cap on a channel purpose or topic. */
export const SLACK_TEXT_MAX = 250;

/** A message assigns a home directory when it matches all of these. */
export const DEFAULT_SWEEP_PATTERNS = [
  String.raw`\bseed(?:ed|ing)?\s+meta`,
  String.raw`\bhome\s+dir(?:ectory)?\b`,
];

/** A whole number from 1 to `max`, `fallback` when unset. */
const boundedInt = (max: number, fallback: number) =>
  z.number().int().min(1).max(max).default(fallback);

/** Whether `source` compiles as a regular expression. */
const isRegExp = (source: string): boolean => {
  try {
    new RegExp(source, 'i');
    return true;
  } catch {
    return false;
  }
};

/** The `slack.channelMeta` block (spec 2.6; the table is guides/slack.md). */
export const slackChannelMetaSchema = z.strictObject({
  /** Summary target: a channel (`C`/`G`/`D`) or a user (`U`/`W`, their DM); default the OpenClaw command owner's DM. */
  reportChannel: z
    .string()
    .regex(
      /^[CGDUW][A-Z0-9]{2,}$/,
      'reportChannel must be a Slack channel or user id',
    )
    .optional(),
  /** Gateway Slack account whose bot posts the summary; default found. */
  reportAccount: z.string().trim().min(1).optional(),
  /** Gateway Slack accounts whose channels the report may name and quote; default the report target's own. */
  reportTextAccounts: z.array(z.string().trim().min(1)).optional(),
  /** Report directory; default `slack.channels.<reportChannel>.homeDir`, required when the report goes to a DM. */
  outputDir: absolutePathSchema('outputDir').optional(),
  /** IANA zone of the report date (no default). */
  timezone: z
    .string()
    .refine(isTimeZone, { message: 'timezone must be an IANA time zone' }),
  /** jeeves-server machine key (in the server's own `keys`) that resolves the report's insider link. */
  serverKey: z.string().trim().min(1),
  /** Longest description (Slack purpose) the runnable sets. */
  descriptionMaxChars: boundedInt(SLACK_TEXT_MAX, 250),
  /** Longest topic the runnable sets. */
  topicMaxChars: boundedInt(SLACK_TEXT_MAX, 160),
  /** Recent-message window for topics, in days. */
  activityDays: boundedInt(90, 7),
  /** Channels sent to the worker per run; the rest wait. */
  maxChannels: boundedInt(200, 20),
  /** Channel ids left out. */
  excludeChannels: z.array(slackChannelIdSchema).default([]),
  /** `false`: report only, never set a description. */
  updateDescriptions: z.boolean().default(true),
  /** `false`: report only, never set a topic. */
  updateTopics: z.boolean().default(true),
  /** A written path's first segment to the absolute directory it stands for. */
  pathRoots: z
    .record(z.string(), absolutePathSchema('a pathRoots directory'))
    .refine((roots) => Object.keys(roots).every((k) => /^[^\\/\s]+$/.test(k)), {
      message: 'a pathRoots key is one path segment',
    })
    .default({}),
  /** Directory a back-ticked relative path is resolved against. */
  relativeRoot: absolutePathSchema('relativeRoot').optional(),
  /** Regular expressions (case-insensitive) a message must all match to assign a home directory. */
  sweepPatterns: z
    .array(
      z.string().min(1).refine(isRegExp, {
        message: 'sweepPatterns entry is not a valid regular expression',
      }),
    )
    .min(1)
    .default(DEFAULT_SWEEP_PATTERNS),
});

/** The `slack.channelMeta` block (defaults applied). */
export type SlackChannelMetaBlock = z.infer<typeof slackChannelMetaSchema>;

/** Whether a report target is a channel (`C…`/`G…`), which may have a `homeDir`. */
export const isChannelTarget = (id: string): boolean => /^[CG]/.test(id);

/**
 * The report directory when `outputDir` is unset, written once for the
 * config check (`config/schema`) and the run (`channel-meta/settings`):
 * the report channel's `homeDir`. A DM target (a `D` id, a user, or
 * `reportChannel` unset, the OpenClaw owner's DM) has none, and neither
 * may a channel; either way `outputDir` is required.
 *
 * @param target - The report target, `undefined` for the owner's DM.
 * @param homeDirOf - A channel's configured `homeDir`.
 * @returns The directory, or why `outputDir` is required.
 */
export function defaultReportDir(
  target: string | undefined,
  homeDirOf: (channelId: string) => string | undefined,
): { homeDir: string } | { problem: string } {
  if (target === undefined || !isChannelTarget(target))
    return {
      problem:
        'slack.channelMeta.outputDir is required: the report goes to a DM, which has no homeDir',
    };
  const homeDir = homeDirOf(target);
  return homeDir === undefined
    ? {
        problem: `slack.channelMeta.outputDir is required: the report channel ${target} has no slack.channels.${target}.homeDir`,
      }
    : { homeDir };
}

/** The parts of a parsed `slack` block {@link reportDirIssue} reads. */
interface SlackBlock {
  /** Per-channel decisions. */
  channels: Readonly<Record<string, { homeDir?: string }>>;
  /** The `channelMeta` block, if any. */
  channelMeta?: SlackChannelMetaBlock;
}

/**
 * The report directory rule on a parsed `slack` block, for the config
 * check: a `channelMeta` block with no `outputDir` whose report target
 * has no `homeDir` ({@link defaultReportDir}).
 *
 * @param slack - The parsed `slack` block.
 * @returns The issue's path under `slack` and message, or `undefined`.
 */
export function reportDirIssue(
  slack: SlackBlock,
): { path: string[]; message: string } | undefined {
  const meta = slack.channelMeta;
  if (meta === undefined || meta.outputDir !== undefined) return undefined;
  const dir = defaultReportDir(
    meta.reportChannel,
    (id) => slack.channels[id]?.homeDir,
  );
  return 'problem' in dir
    ? { path: ['channelMeta', 'outputDir'], message: dir.problem }
    : undefined;
}
