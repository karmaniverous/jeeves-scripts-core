/**
 * @module email/poll.test-helper
 *
 * Accounts and {@link EmailPollDeps} for the email-poll tests: one
 * polling gmail account, one not polling, one IMAP account, every
 * collaborator a stub. Test support only.
 */

import path from 'node:path';

import type { RunnerClient } from '@karmaniverous/jeeves-runner';
import { vi } from 'vitest';

import type { AccountConfig } from '../config/index.js';
import type { EmailPollDeps } from './poll.js';
import { trimJsonlFiles } from './trim-jsonl.js';

/** A gmail (gog) account. */
export const gmail = (email: string, emailPolling = true): AccountConfig => ({
  email,
  type: 'gmail',
  emailPolling,
});

/** An IMAP account. */
export const imap = (email: string): AccountConfig => ({
  email,
  type: 'imap',
  emailPolling: true,
  imap: {
    host: 'h',
    port: 993,
    tls: true,
    user: email,
    password: { secretRef: 'x' },
  },
});

/** What the stub IMAP poll returns. */
export const stats = {
  fetched: 3,
  written: 2,
  skipped: 1,
  failed: 0,
  folders: 1,
};

/** Deps with events under `dir`, the given runner client, and `over`. */
export const pollDeps = (
  dir: string,
  client: RunnerClient,
  over: Partial<EmailPollDeps> = {},
): EmailPollDeps => ({
  config: () => ({
    accounts: [gmail('a@x.com'), gmail('off@x.com', false), imap('i@x.com')],
    emailConfig: { reportOnly: true, digest: { slackChannelId: '' } },
  }),
  eventsDir: path.join(dir, 'events'),
  runner: () => client,
  pollImap: vi.fn(() => Promise.resolve(stats)),
  pollGog: vi.fn(),
  requireGog: () => true,
  trim: (d) => {
    trimJsonlFiles(d, 7);
  },
  now: () => '2026-06-01T00:00:00.000Z',
  ...over,
});
