/**
 * @module config/punch-list-schema
 *
 * Zod schema for the top-level `punchList` block (spec 2.7, #45): where an
 * instance keeps its daily punch-list files, the zone its day rolls over
 * in, its notification channel, its own scripts repo and where each
 * released component installs. The whole block is optional (absent:
 * both punch-list runnables skip); a present block missing a required
 * field fails `config check` and every run (Decision 76). Derived paths
 * are resolved by `punchListConfig()` (`config/punch-list.ts`).
 */

import { z } from 'zod';

import { isTimeZone } from '../lib/dates.js';
import { normalizeSlackTarget } from '../lib/worker-slack/slack-target.js';
import { absolutePathSchema } from './absolute-path.js';

/** `owner/name`. */
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** An `owner/name` GitHub repo; `what` names it in errors. */
const repoSchema = (what: string) =>
  z.string().regex(REPO_RE, `${what} must be owner/name`);

/** One released component and where its installed `package.json` lives. */
export const punchListInstallTargetSchema = z.object({
  /** Release-tag component (`service` in `service/3.15.0`); `''` for bare `3.15.0` tags. */
  component: z.string(),
  /** Glob of the installed `package.json`; `{npmGlobal}` and `{home}` are expanded. */
  packageJson: z.string().min(1),
});

/** The notification channel: a channel or user id, or a `channel:` / `user:` target (`normalizeSlackTarget`). */
const slackChannelSchema = z
  .string()
  .refine((raw) => normalizeSlackTarget(raw) !== null, {
    message: 'slack.channel must be a Slack channel or user id',
  });

/** The `punchList` block. */
export const punchListSchema = z.object({
  /** Directory of the daily files, `harvest/` records and an optional `TASK.md`. */
  dir: absolutePathSchema('dir'),
  /** The day rolls over in this IANA zone (day boundaries only, not when the runner fires). */
  timeZone: z
    .string()
    .refine(isTimeZone, { message: 'timeZone must be an IANA time zone' }),
  /** Days a finished entry stays before it is left off the next day's file (default 30). */
  retentionDays: z.number().int().positive().default(30),
  /** Where both runnables post. */
  slack: z.object({
    /** Channel or user id the runnables post to. */
    channel: slackChannelSchema,
    /** Gateway Slack account whose bot token posts (default `default`). */
    account: z.string().min(1).default('default'),
    /** `ts` of the pinned quick-links message; unset: the harvester leaves it alone. */
    pinnedTs: z.string().min(1).optional(),
  }),
  /** Absolute path of the punch-list spec, linked from the pinned message and the harvest task. */
  specPath: absolutePathSchema('specPath').optional(),
  /** This instance's scripts repo: unversioned, so Done means a merged PR. */
  scriptsRepo: z.object({
    /** `owner/name`. */
    repo: repoSchema('scriptsRepo.repo'),
    /** The deployed clone; a PR is installed once its merge commit is in its HEAD. */
    clone: absolutePathSchema('scriptsRepo.clone'),
  }),
  /** Versioned repos (`owner/name`) scanned for milestones, with where each component installs (default none). */
  installMap: z
    .record(repoSchema('installMap key'), z.array(punchListInstallTargetSchema))
    .default({}),
  /** Lock held by every runnable write (default `{stateDir}/punch-list/punch-list.lock`). */
  lockFile: absolutePathSchema('lockFile').optional(),
  /** Notifications not yet posted (default `{stateDir}/punch-list/status-pending.json`). */
  pendingFile: absolutePathSchema('pendingFile').optional(),
  /** Harvest window cursor (default `{stateDir}/punch-list/harvest-cursor.json`). */
  cursorFile: absolutePathSchema('cursorFile').optional(),
  /** Where the harvest worker writes its report (default `{stateDir}/punch-list/inbox`). */
  inboxDir: absolutePathSchema('inboxDir').optional(),
  /**
   * What the harvester's pre-check watches for new input (default: the
   * default silo's `email`, `slack`, `meetings` and `google-drive`, plus
   * `{stateDir}/jeeves-watcher/issues.json`).
   */
  inputRoots: z.array(absolutePathSchema('inputRoots entry')).min(1).optional(),
});

/** One install-map entry. */
export type PunchListInstallTarget = z.infer<
  typeof punchListInstallTargetSchema
>;
/** The `punchList` block as configured (defaults applied, derived paths unresolved). */
export type PunchListBlock = z.infer<typeof punchListSchema>;
