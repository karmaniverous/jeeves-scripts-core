/**
 * @module email/imap/poll-state
 *
 * Per-account IMAP poll state in the runner (namespace `imap-poll`, key =
 * account email): the UID watermark of each folder.
 */

import { type RunnerClient } from '@karmaniverous/jeeves-runner';

// ── State ─────────────────────────────────────────────────────────────

export interface FolderWatermark {
  uidValidity: number;
  lastUid: number;
}

export interface ImapPollState {
  folders: Record<string, FolderWatermark>;
}

const STATE_NS = 'imap-poll';

/** The account's poll state; no folders before the first poll. */
export function loadState(email: string, client: RunnerClient): ImapPollState {
  const raw = client.getState(STATE_NS, email);
  if (!raw) return { folders: {} };
  return JSON.parse(raw) as ImapPollState;
}

/** Persist the account's poll state. */
export function saveState(
  email: string,
  state: ImapPollState,
  client: RunnerClient,
): void {
  client.setState(STATE_NS, email, JSON.stringify(state));
}
