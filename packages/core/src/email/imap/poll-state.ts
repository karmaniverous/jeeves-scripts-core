/**
 * @module email/imap/poll-state
 *
 * Per-account IMAP poll state in the runner (namespace `imap-poll`, key =
 * account email): the UID watermark of each folder. Stored state is
 * parsed with a schema; state that isn't valid JSON or doesn't match is
 * treated like missing state (no folders: the next poll is a first run)
 * and logged as a warning.
 */

import { type RunnerClient } from '@karmaniverous/jeeves-runner';
import { z } from 'zod';

// ── State ────────────────────────────────────────────────────────────

const uid = z.number().int().nonnegative();

/** One folder's watermark: its UIDVALIDITY and the last UID polled. */
const folderWatermarkSchema = z.object({
  uidValidity: uid,
  lastUid: uid,
});

/** One folder's watermark: its UIDVALIDITY and the last UID polled. */
export type FolderWatermark = z.infer<typeof folderWatermarkSchema>;

/** An account's poll state: watermarks keyed by folder path. */
const imapPollStateSchema = z.object({
  folders: z.record(z.string(), folderWatermarkSchema),
});

/** An account's poll state: watermarks keyed by folder path. */
export type ImapPollState = z.infer<typeof imapPollStateSchema>;

const STATE_NS = 'imap-poll';

function parseState(raw: string): ImapPollState | string {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  const parsed = imapPollStateSchema.safeParse(json);
  return parsed.success ? parsed.data : z.prettifyError(parsed.error);
}

/**
 * The account's poll state; no folders before the first poll, or when the
 * stored state is invalid (warned, not thrown).
 */
export function loadState(email: string, client: RunnerClient): ImapPollState {
  const raw = client.getState(STATE_NS, email);
  if (!raw) return { folders: {} };
  const state = parseState(raw);
  if (typeof state !== 'string') return state;
  console.warn(
    `[imap] ${email}: ignoring invalid poll state (${state.replace(/\s+/g, ' ')}); polling as a first run`,
  );
  return { folders: {} };
}

/** Persist the account's poll state. */
export function saveState(
  email: string,
  state: ImapPollState,
  client: RunnerClient,
): void {
  client.setState(STATE_NS, email, JSON.stringify(state));
}
