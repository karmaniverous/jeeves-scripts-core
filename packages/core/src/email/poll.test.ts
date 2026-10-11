import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountConfig } from '../config/index.js';
import { fakeRunnerClient } from '../lib/fake-runner-client.test-helper.js';
import { type EmailPollDeps, emailPollDeps, pollEmail } from './poll.js';

let dir: string;
let runner: ReturnType<typeof fakeRunnerClient>;

const gmail = (email: string, emailPolling = true): AccountConfig => ({
  email,
  type: 'gmail',
  emailPolling,
});
const imap = (email: string): AccountConfig => ({
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

const stats = { fetched: 3, written: 2, skipped: 1, failed: 0, folders: 1 };

const deps = (over: Partial<EmailPollDeps> = {}): EmailPollDeps => ({
  config: () => ({
    accounts: [gmail('a@x.com'), gmail('off@x.com', false), imap('i@x.com')],
    emailConfig: { reportOnly: true, digest: { slackChannelId: '' } },
  }),
  eventsDir: path.join(dir, 'events'),
  runner: () => runner.client,
  pollImap: vi.fn(() => Promise.resolve(stats)),
  pollGog: vi.fn(),
  requireGog: () => true,
  now: () => '2026-06-01T00:00:00.000Z',
  ...over,
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-poll-'));
  runner = fakeRunnerClient();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('pollEmail', () => {
  it('polls IMAP accounts (logging a run line) then polling-enabled gog accounts', async () => {
    const d = deps();
    await pollEmail(d);
    expect(d.pollImap).toHaveBeenCalledTimes(1);
    const run = JSON.parse(
      fs
        .readFileSync(path.join(dir, 'events', '_runs-imap-poll.jsonl'), 'utf8')
        .trim(),
    ) as Record<string, unknown>;
    expect(run).toEqual({
      at: '2026-06-01T00:00:00.000Z',
      kind: 'imap-poll',
      account: 'i@x.com',
      ...stats,
    });
    expect(d.pollGog).toHaveBeenCalledTimes(1);
    expect(d.pollGog).toHaveBeenCalledWith({
      account: 'a@x.com',
      client: runner.client,
      reportOnly: true,
      query: 'in:anywhere',
      max: 100,
    });
    expect(console.log).toHaveBeenCalledWith(
      '[gog] reportOnly: no Gmail label actions will be enqueued',
    );
    expect(runner.closed()).toBe(true);
  });

  it('logs an IMAP failure and still polls gog', async () => {
    const d = deps({ pollImap: () => Promise.reject(new Error('timeout')) });
    await pollEmail(d);
    expect(console.error).toHaveBeenCalledWith('[imap] i@x.com error: timeout');
    expect(d.pollGog).toHaveBeenCalledTimes(1);
  });

  it('skips gog accounts without a gog credential, and fails when gog requires one', async () => {
    const d = deps({ requireGog: () => false });
    await pollEmail(d);
    expect(d.pollGog).not.toHaveBeenCalled();
    const failing = deps({
      requireGog: () => {
        throw new Error('no gog credentials');
      },
    });
    await expect(pollEmail(failing)).rejects.toThrow('no gog credentials');
    expect(runner.closed()).toBe(true);
  });
});

describe('emailPollDeps', () => {
  it('reads the events directory from config', () => {
    const live = emailPollDeps();
    expect(live.eventsDir).toMatch(/events/);
    expect(live.config().accounts).toEqual([]);
    expect(live.requireGog(0)).toBe(false);
  });
});
