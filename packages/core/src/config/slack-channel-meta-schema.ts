/**
 * @module config/slack-channel-meta-schema
 *
 * The `slack.channelMeta` block of `slack-refresh-channel-meta` (spec
 * 2.6, #49): every key, its default and its bounds. `config/slack-schema`
 * puts it in the `slack` block, adds the report directory rule (which
 * needs `slack.channels`) and re-exports the schema and its type; the
 * helpers here stay off the root export.
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
