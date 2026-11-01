/**
 * @module slack/channel-meta/sweep
 *
 * The home-directory sweep: find the latest human post in a channel that
 * assigns its home directory (matches every sweep pattern and names a
 * path; `channel-meta/paths`), and compare it with `slack.channels.<id>.homeDir`.
 * The job never edits the instance config (Decision 66): a missing entry
 * becomes a proposal (the report gives the exact `config set` command), a
 * different entry
 * a mismatch, and a path that does not exist on disk is reported instead
 * of proposed. A post whose path can't be read is skipped and reported
 * by its ts. Pure.
 */

import { getErrorMessage } from '@karmaniverous/jeeves';

import { type ChannelMessage, compareTs, isHumanMessage } from './messages.js';
import {
  extractPath,
  type PathRoots,
  type PlatformPath,
  samePath,
} from './paths.js';

/** A home-directory assignment found in a channel. */
export interface Assignment {
  /** The post's ts. */
  ts: string;
  /** The assigned directory, canonical absolute. */
  path: string;
}

/**
 * Whether a message text assigns a home directory (matches every pattern).
 *
 * @param text - Message text.
 * @param patterns - Sweep patterns.
 * @returns `true` when all match.
 */
export const isAssignmentText = (
  text: string,
  patterns: readonly RegExp[],
): boolean => patterns.every((p) => p.test(text));

/** What {@link latestAssignment} found. */
export interface AssignmentScan {
  /** The latest assignment, if any. */
  assignment?: Assignment;
  /** Posts whose path couldn't be read: the post's ts and the error
   * (never its text). */
  failed: { ts: string; error: string }[];
}

/**
 * The latest assignment among `messages` and an earlier one. A post
 * whose path can't be read is skipped and listed, so one bad post never
 * stops the sweep.
 *
 * @param messages - Messages to scan (any order).
 * @param patterns - Sweep patterns.
 * @param roots - Path roots.
 * @param previous - The assignment found by an earlier run.
 * @returns The latest assignment with a path (or `previous`), and the
 *   posts that failed.
 */
export function latestAssignment(
  messages: readonly ChannelMessage[],
  patterns: readonly RegExp[],
  roots: PathRoots,
  previous?: Assignment,
): AssignmentScan {
  let best = previous;
  const failed: AssignmentScan['failed'] = [];
  for (const m of messages) {
    if (!isHumanMessage(m) || !m.text) continue;
    if (!isAssignmentText(m.text, patterns)) continue;
    let found: string | undefined;
    try {
      found = extractPath(m.text, roots);
    } catch (e) {
      failed.push({ ts: m.ts, error: getErrorMessage(e) });
      continue;
    }
    if (found === undefined) continue;
    if (best === undefined || compareTs(m.ts, best.ts) > 0)
      best = { ts: m.ts, path: found };
  }
  return best === undefined ? { failed } : { assignment: best, failed };
}

/** What the sweep says about one channel. */
export type SweepFinding =
  | { kind: 'proposal'; path: string }
  | { kind: 'mismatch'; path: string; configured: string; exists: boolean }
  | { kind: 'missing-dir'; path: string };

/**
 * Compare an assignment with the configured home directory.
 *
 * @param assignment - The latest assignment, if any.
 * @param configured - `slack.channels.<id>.homeDir`, if any.
 * @param exists - Whether a directory exists.
 * @param host - The host's path style (for comparing paths).
 * @returns The finding, or `undefined` when there is nothing to report.
 */
export function compareAssignment(
  assignment: Assignment | undefined,
  configured: string | undefined,
  exists: (dir: string) => boolean,
  host: PlatformPath,
): SweepFinding | undefined {
  if (assignment === undefined) return undefined;
  const { path } = assignment;
  if (configured === undefined)
    return exists(path)
      ? { kind: 'proposal', path }
      : { kind: 'missing-dir', path };
  if (samePath(path, configured, host)) return undefined;
  return { kind: 'mismatch', path, configured, exists: exists(path) };
}
