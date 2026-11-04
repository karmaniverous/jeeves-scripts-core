/**
 * email-poll failure handling around the accounts (#66 review): a missing
 * gog credential joins the IMAP failures, a run-log write failure never
 * stops the run, and a trim failure never hides the account error.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountConfig } from '../config/index.js';
import { fakeRunnerClient } from '../lib/fake-runner-client.test-helper.js';
import { type EmailPollDeps, emailPollDeps, pollEmail } from './poll.js';
import { gmail, imap, pollDeps, stats } from './poll.test-helper.js';

let dir: string;
let runner: ReturnType<typeof fakeRunnerClient>;

const deps = (over: Partial<EmailPollDeps> = {}): EmailPollDeps =>
  pollDeps(dir, runner.client, over);

/** Two IMAP accounts (the first fails, the second succeeds) and one gmail account. */
const mixed = (over: Partial<EmailPollDeps> = {}): EmailPollDeps =>
  deps({
    config: () => ({
      accounts: [imap('i@x.com'), imap('j@x.com'), gmail('a@x.com')],
      emailConfig: { reportOnly: false, digest: { slackChannelId: '' } },
    }),
    pollImap: vi.fn((a: AccountConfig) =>
      a.email === 'i@x.com'
        ? Promise.reject(new Error('auth failed'))
        : Promise.resolve(stats),
    ),
    ...over,
  });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-poll-fail-'));
  runner = fakeRunnerClient();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('pollEmail failure handling', () => {
  it('folds a missing gog credential into the error with the IMAP failures', async () => {
    const d = mixed({
      requireGog: () => {
        throw new Error('no gog credentials');
      },
    });
    await expect(pollEmail(d)).rejects.toHaveProperty(
      'message',
      'email/poll: 2 account(s) failed: [imap] i@x.com: auth failed; [gog] gog: no gog credentials',
    );
    expect(d.pollImap).toHaveBeenCalledTimes(2);
    expect(d.pollGog).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      '[gog] credentials error: no gog credentials',
    );
    expect(runner.closed()).toBe(true);
  });

  it('keeps polling when a run line cannot be written, and logs it', async () => {
    // A directory where the run log should be: every append throws.
    fs.mkdirSync(path.join(dir, 'events', '_runs-imap-poll.jsonl'), {
      recursive: true,
    });
    const d = mixed();
    await expect(pollEmail(d)).rejects.toHaveProperty(
      'message',
      'email/poll: 1 account(s) failed: [imap] i@x.com: auth failed',
    );
    expect(d.pollImap).toHaveBeenCalledTimes(2);
    expect(d.pollGog).toHaveBeenCalledTimes(1);
    const writeErrors = vi
      .mocked(console.error)
      .mock.calls.filter(([m]) =>
        String(m).startsWith(
          'email/poll: could not write _runs-imap-poll.jsonl: ',
        ),
      );
    expect(writeErrors).toHaveLength(2);
  });

  it('never replaces the account error with a trim error, and logs it', async () => {
    const d = mixed({
      trim: () => {
        throw new Error('disk gone');
      },
    });
    await expect(pollEmail(d)).rejects.toHaveProperty(
      'message',
      'email/poll: 1 account(s) failed: [imap] i@x.com: auth failed',
    );
    expect(console.error).toHaveBeenCalledWith(
      'email/poll: trimming logs failed: disk gone',
    );
    expect(runner.closed()).toBe(true);
  });

  it('fails with the trim error when nothing else failed', async () => {
    const d = deps({
      trim: () => {
        throw 'disk gone' as unknown as Error;
      },
    });
    await expect(pollEmail(d)).rejects.toThrow('disk gone');
    expect(runner.closed()).toBe(true);
  });

  it('the live trim is a no-op for a missing events directory', () => {
    expect(() => {
      emailPollDeps().trim(path.join(dir, 'missing'));
    }).not.toThrow();
  });
});
