/**
 * @module slack/channel-meta/state
 *
 * The job's own state, one JSON file under the instance state folder
 * (`{stateDir}/slack/channel-meta/state.json`; state, never config):
 *
 * - per channel: how far the sweep has read (`sweptTs`) and the latest
 *   assignment it found, so a run reads only new messages;
 * - per channel and field (description, topic): the meta `_generatedAt`
 *   (and, for topics, the newest human message) the job last generated
 *   the value from, so it regenerates only when there is something new
 *   (`channel-meta/plan`) and the worker's batch goes to the channels that need it;
 * - the last delivered report's hash, so an unchanged report is not
 *   written or posted again (a quiet day).
 *
 * A missing file (`ENOENT`) is an empty state; one that can't be read
 * for any other reason, or is invalid, fails the run before anything is
 * set in Slack (fix or move it aside: the job then regenerates every
 * field once). Written atomically.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { atomicWrite } from '@karmaniverous/jeeves';
import { z } from 'zod';

import { decodeSlack } from './slack-text.js';

const fieldStateSchema = z.object({
  /** Meta `_generatedAt` the value was generated from. */
  generatedAt: z.string().optional(),
  /** Newest human message ts the value was generated from (topics). */
  lastMessageTs: z.string().optional(),
  /** When the job last generated it (ISO), written or already current. */
  checkedAt: z.string(),
});

/** What the job last generated for one field. */
export type FieldState = z.infer<typeof fieldStateSchema>;

const channelStateSchema = z.object({
  sweptTs: z.string().optional(),
  assignment: z.object({ ts: z.string(), path: z.string() }).optional(),
  description: fieldStateSchema.optional(),
  topic: fieldStateSchema.optional(),
});

/** One channel's state. */
export type ChannelState = z.infer<typeof channelStateSchema>;

const stateSchema = z.object({
  version: z.literal(1),
  channels: z.record(z.string(), channelStateSchema),
  reportHash: z.string().optional(),
});

/** The whole state. */
export type JobState = z.infer<typeof stateSchema>;

/** A fresh state. */
export const emptyState = (): JobState => ({ version: 1, channels: {} });

/**
 * Normalise a Slack purpose/topic for comparison: entities decoded,
 * whitespace collapsed, trimmed.
 */
export const normalizeSlackText = (text: string): string =>
  decodeSlack(text).replace(/\s+/g, ' ').trim();

/** sha256 (hex) of a normalised text (the report's quiet-day key). */
export const hashText = (text: string): string =>
  createHash('sha256').update(normalizeSlackText(text)).digest('hex');

/**
 * Load the state.
 *
 * @param file - The state file.
 * @returns The state (empty when the file does not exist).
 * @throws Error when the file is not valid state, or can't be read for
 *   any reason but its absence (`EACCES`, `EIO`, …): the run stops before
 *   it writes anything to Slack.
 */
export function loadState(file: string): JobState {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
    throw e;
  }
  const parsed = stateSchema.safeParse(
    (() => {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return undefined;
      }
    })(),
  );
  if (!parsed.success)
    throw new Error(
      `${file} is not valid slack-refresh-channel-meta state; fix or move it aside (the job then regenerates every description and topic once)`,
    );
  return parsed.data;
}

/**
 * Save the state atomically.
 *
 * @param file - The state file (its directory is created).
 * @param state - The state.
 */
export function saveState(file: string, state: JobState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWrite(file, `${JSON.stringify(state, null, 2)}\n`);
}
