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
      reportOnly: expect.any(Function) as unknown,
      query: 'in:anywhere',
      max: 100,
    });
    expect(console.log).toHaveBeenCalledWith(
      '[gog] a@x.com reportOnly: no Gmail label actions will be enqueued',
    );
    expect(runner.closed()).toBe(true);
  });

  it('resolves report-only per account when the global flag is off', async () => {
    const d = deps({
      config: () => ({
        accounts: [
          { ...gmail('shared@x.com'), reportOnly: true },
          gmail('a@x.com'),
        ],
        emailConfig: { reportOnly: false, digest: { slackChannelId: '' } },
      }),
    });
    await pollEmail(d);
    const policies = vi
      .mocked(d.pollGog)
      .mock.calls.map(([ctx]) => [ctx.account, ctx.reportOnly(ctx.account)]);
    expect(policies).toEqual([
      ['shared@x.com', true],
      ['a@x.com', false],
    ]);
    expect(console.log).toHaveBeenCalledWith(
      '[gog] shared@x.com reportOnly: no Gmail label actions will be enqueued',
    );
    expect(console.log).not.toHaveBeenCalledWith(
      '[gog] a@x.com reportOnly: no Gmail label actions will be enqueued',
    );
  });

  describe('one failing account (#66)', () => {
    const runLines = (file: string) =>
      fs
        .readFileSync(path.join(dir, 'events', file), 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as Record<string, unknown>);
    const oldEvents = () => {
      fs.mkdirSync(path.join(dir, 'events'), { recursive: true });
      const file = path.join(dir, 'events', 'thread-events.jsonl');
      fs.writeFileSync(file, '{"at":"2000-01-01T00:00:00.000Z"}\n');
      return file;
    };

    it('gog: polls every other account, trims, then fails naming the account', async () => {
      const events = oldEvents();
      const pollGog = vi.fn((ctx: { account: string }) => {
        if (ctx.account === 'b@x.com')
          throw new Error(
            'invalid_grant: Token has been expired or revoked.\nmore',
          );
      });
      const d = deps({
        config: () => ({
          accounts: [gmail('a@x.com'), gmail('b@x.com'), gmail('c@x.com')],
          emailConfig: { reportOnly: false, digest: { slackChannelId: '' } },
        }),
        pollGog,
      });

      await expect(pollEmail(d)).rejects.toHaveProperty(
        'message',
        'email/poll: 1 account(s) failed: [gog] b@x.com: invalid_grant: Token has been expired or revoked.',
      );
      expect(pollGog.mock.calls.map(([c]) => c.account)).toEqual([
        'a@x.com',
        'b@x.com',
        'c@x.com',
      ]);
      expect(console.error).toHaveBeenCalledWith(
        '[gog] b@x.com error: invalid_grant: Token has been expired or revoked.\nmore',
      );
      const failed = 'b@x.com';
      expect(runLines(`_runs-${failed}.jsonl`)).toEqual([
        {
          at: '2026-06-01T00:00:00.000Z',
          kind: 'gog-poll',
          account: 'b@x.com',
          error: 'invalid_grant: Token has been expired or revoked.\nmore',
        },
      ]);
      expect(fs.readFileSync(events, 'utf8')).toBe('');
      expect(runner.closed()).toBe(true);
    });

    it('IMAP: a failure now fails the run, after every account is polled', async () => {
      const pollImap = vi.fn((a: AccountConfig) =>
        a.email === 'i@x.com'
          ? Promise.reject(new Error('auth failed'))
          : Promise.resolve(stats),
      );
      const d = deps({
        config: () => ({
          accounts: [imap('i@x.com'), imap('j@x.com'), gmail('a@x.com')],
          emailConfig: { reportOnly: false, digest: { slackChannelId: '' } },
        }),
        pollImap,
      });

      await expect(pollEmail(d)).rejects.toThrow(
        'email/poll: 1 account(s) failed: [imap] i@x.com: auth failed',
      );
      expect(pollImap).toHaveBeenCalledTimes(2);
      expect(d.pollGog).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledWith(
        '[imap] i@x.com error: auth failed',
      );
      expect(runLines('_runs-imap-poll.jsonl')[0]).toEqual({
        at: '2026-06-01T00:00:00.000Z',
        kind: 'imap-poll',
        account: 'i@x.com',
        error: 'auth failed',
      });
      expect(
        runLines('_runs-imap-poll.jsonl').map((l) => [l.account, l.error]),
      ).toEqual([
        ['i@x.com', 'auth failed'],
        ['j@x.com', undefined],
      ]);
    });

    it('records a thrown non-Error as its string', async () => {
      const d = deps({
        pollGog: vi.fn(() => {
          // A dependency may throw a plain string.
          throw 'gog exited 1' as unknown as Error;
        }),
      });
      await expect(pollEmail(d)).rejects.toThrow(
        'email/poll: 1 account(s) failed: [gog] a@x.com: gog exited 1',
      );
      const failed = 'a@x.com';
      expect(runLines(`_runs-${failed}.jsonl`).at(-1)).toMatchObject({
        kind: 'gog-poll',
        error: 'gog exited 1',
      });
    });

    it('names every failed account in one error, polling each once', async () => {
      const d = deps({
        pollImap: () => Promise.reject(new Error('timeout')),
        pollGog: vi.fn(() => {
          throw new Error('invalid_grant');
        }),
      });
      await expect(pollEmail(d)).rejects.toThrow(
        'email/poll: 2 account(s) failed: [imap] i@x.com: timeout; [gog] a@x.com: invalid_grant',
      );
      expect(d.pollGog).toHaveBeenCalledTimes(1);
    });

    it('trims the logs even when the run fails before polling gog', async () => {
      const events = oldEvents();
      const d = deps({
        requireGog: () => {
          throw new Error('no gog credentials');
        },
      });
      await expect(pollEmail(d)).rejects.toThrow(
        'email/poll: 1 account(s) failed: [gog] gog: no gog credentials',
      );
      expect(fs.readFileSync(events, 'utf8')).toBe('');
      expect(runner.closed()).toBe(true);
    });

    it('resolves when every account succeeds', async () => {
      const events = oldEvents();
      await expect(pollEmail(deps())).resolves.toBeUndefined();
      expect(console.error).not.toHaveBeenCalled();
      expect(fs.readFileSync(events, 'utf8')).toBe('');
    });
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
