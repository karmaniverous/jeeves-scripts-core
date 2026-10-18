import fs from 'node:fs';

import type * as Runner from '@karmaniverous/jeeves-runner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { argsError } from '../../jobs/job-help.js';
import { constants } from '../../lib/constants.js';
import type { RunSummary } from './respond/orchestrate.js';

const mocks = vi.hoisted(() => ({
  runEmailRespond: vi.fn(),
  dispatchSession: vi.fn(() => Promise.resolve({ exitCode: 0, stdout: '' })),
}));
vi.mock('@karmaniverous/jeeves-runner', async (importOriginal) => ({
  ...(await importOriginal<typeof Runner>()),
  dispatchSession: mocks.dispatchSession,
}));
vi.mock('./respond/orchestrate.js', () => ({
  runEmailRespond: mocks.runEmailRespond,
}));

import job, {
  emailRespond,
  type EmailRespondEnv,
  emailRespondEnv,
  gogRespondDeps,
} from './respond.js';

const MAILBOX = 'aide@example.com';

const summary = (over: Partial<RunSummary> = {}): RunSummary => ({
  discovered: 0,
  alreadyHandled: 0,
  skipped: 0,
  capped: 0,
  attempted: 0,
  replied: 0,
  declined: 0,
  failedPermanently: [],
  failedRetrying: [],
  ...over,
});

const env = (
  respond: Record<string, unknown> | undefined,
  over: Partial<EmailRespondEnv> = {},
): EmailRespondEnv & { lines: string[] } => {
  const lines: string[] = [];
  return {
    lines,
    pipeline: () =>
      ({
        emailConfig: { reportOnly: false, respond },
      }) as never,
    gog: vi.fn(() => JSON.stringify({ threads: [] })),
    runnerClient: () =>
      ({ getItem: vi.fn(() => null), setItem: vi.fn() }) as never,
    dispatch: vi.fn(),
    readFinalText: vi.fn(),
    slackDirectory: () => null,
    slackSend: vi.fn(),
    now: () => '2026-10-18T00:00:00.000Z',
    log: (line) => lines.push(line),
    ...over,
  };
};

const RESPOND = {
  mailbox: MAILBOX,
  allowedSenders: ['owner@example.com'],
  maxRepliesPerThreadPerHour: 3,
  maxPerRun: 3,
  label: 'assistant-replied',
  slackMirror: false,
};

beforeEach(() => {
  mocks.runEmailRespond.mockReset();
  mocks.runEmailRespond.mockResolvedValue(summary());
});

describe('emailRespond', () => {
  it('rejects anything but --dry-run, and parses it for the run', () => {
    expect(argsError(job, ['--live'])).toMatch(
      /^Unknown option --live for email-respond/,
    );
    expect(argsError(job, ['--dry-run'])).toBeUndefined();
  });

  it('does nothing when emailConfig.respond is not configured', async () => {
    const e = env(undefined);
    await emailRespond({ dryRun: false }, e);
    expect(e.lines).toEqual([
      '[email-respond] emailConfig.respond is not configured; nothing to do',
    ]);
    expect(mocks.runEmailRespond).not.toHaveBeenCalled();
  });

  it('discovers, runs and logs the summary; --dry-run is passed on', async () => {
    const e = env(RESPOND);
    await emailRespond({ dryRun: true }, e);
    expect(mocks.runEmailRespond).toHaveBeenCalledWith(
      RESPOND,
      [],
      expect.objectContaining({ now: e.now, dispatch: e.dispatch }),
      { dryRun: true, mailbox: MAILBOX, label: 'assistant-replied' },
    );
    expect(e.lines.at(-1)).toBe(`[email-respond] ${JSON.stringify(summary())}`);
  });

  it('mirrors a sent reply to the sender through slackSend, and not when the mirror is off', async () => {
    const directory = {
      lookupUserByEmail: vi.fn(() => Promise.resolve('U1')),
      resolveChannel: vi.fn(() => Promise.resolve(null)),
      isChannelMember: vi.fn(() => Promise.resolve(false)),
    };
    const e = env(
      { ...RESPOND, slackMirror: true },
      { slackDirectory: () => directory },
    );
    await emailRespond({ dryRun: false }, e);
    const deps = mocks.runEmailRespond.mock.calls[0]?.[2] as {
      mirrorToSlack?: (args: unknown) => Promise<string>;
    };
    await deps.mirrorToSlack?.({
      subject: 'Hi',
      senderEmail: 'owner@example.com',
      recipients: { to: ['owner@example.com'], cc: [], bcc: [] },
      body: 'Done.',
    });
    expect(directory.lookupUserByEmail).toHaveBeenCalledWith(
      'owner@example.com',
    );
    expect(e.slackSend).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('Done.'),
    );

    mocks.runEmailRespond.mockClear();
    await emailRespond(
      { dryRun: false },
      env(RESPOND, { slackDirectory: () => directory }),
    );
    expect(mocks.runEmailRespond.mock.calls[0]?.[2]).not.toHaveProperty(
      'mirrorToSlack',
    );
  });

  it('backs the run deps with runner state and the mirror with slackSend', async () => {
    const client = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const directory = {
      lookupUserByEmail: vi.fn(() => Promise.resolve('U1')),
      resolveChannel: vi.fn(() => Promise.resolve(null)),
      isChannelMember: vi.fn(() => Promise.resolve(false)),
    };
    const e = env(
      { ...RESPOND, slackMirror: true },
      {
        runnerClient: () => client as never,
        slackDirectory: () => directory,
      },
    );
    await emailRespond({ dryRun: false }, e);
    const deps = mocks.runEmailRespond.mock.calls[0]?.[2] as {
      getMessageState: (id: string) => unknown;
      setMessageState: (id: string, v: unknown) => void;
      threadReplyCountSince: (t: string, ms: number) => number;
      recordThreadReply: (t: string, at: string) => void;
    };
    expect(deps.getMessageState('m1')).toBeNull();
    deps.setMessageState('m1', {
      status: 'skipped',
      attempts: 0,
      at: 'x',
      threadId: 't1',
    });
    expect(deps.threadReplyCountSince('t1', 0)).toBe(0);
    deps.recordThreadReply('t1', '2026-10-18T00:00:00.000Z');
    expect(client.getItem).toHaveBeenCalled();
    expect(client.setItem).toHaveBeenCalledTimes(2);
  });

  it('dispatches live workers as email-respond with low thinking and core spawn-worker', async () => {
    await emailRespondEnv().dispatch('TASK');
    expect(mocks.dispatchSession).toHaveBeenCalledWith(
      'TASK',
      { jobId: 'email-respond', thinking: 'low' },
      constants().SPAWN_WORKER_PATH,
    );
  });

  it('throws when a message failed permanently', async () => {
    mocks.runEmailRespond.mockResolvedValue(
      summary({ failedPermanently: ['m1', 'm2'] }),
    );
    await expect(emailRespond({ dryRun: false }, env(RESPOND))).rejects.toThrow(
      'email-respond: 2 message(s) failed permanently: m1, m2',
    );
  });
});

describe('gogRespondDeps', () => {
  it('sends with explicit recipients, never --reply-all, and cleans up the body file', () => {
    const calls: string[][] = [];
    let body = '';
    const gog = vi.fn((args: string[]) => {
      calls.push(args);
      const file = args[args.indexOf('--body-file') + 1] ?? '';
      body = fs.readFileSync(file, 'utf8');
      return '{}';
    });
    gogRespondDeps(gog, MAILBOX).sendReply({
      to: ['a@x.com', 'b@x.com'],
      cc: ['c@x.com'],
      bcc: ['d@x.com'],
      replyToMessageId: 'm1',
      body: 'Hello',
    });
    const args = calls[0] ?? [];
    expect(args).toEqual(
      expect.arrayContaining([
        '--to',
        'a@x.com,b@x.com',
        '--cc',
        'c@x.com',
        '--bcc',
        'd@x.com',
        '--reply-to-message-id',
        'm1',
      ]),
    );
    expect(args).not.toContain('--reply-all');
    expect(body).toBe('Hello');
    expect(fs.existsSync(args[args.indexOf('--body-file') + 1] ?? '')).toBe(
      false,
    );
  });

  it('omits empty Cc and Bcc', () => {
    const gog = vi.fn((_args: string[]) => '{}');
    gogRespondDeps(gog, MAILBOX).sendReply({
      to: ['a@x.com'],
      cc: [],
      bcc: [],
      replyToMessageId: 'm1',
      body: 'x',
    });
    const args = gog.mock.calls[0]?.[0] ?? [];
    expect(args).not.toContain('--cc');
    expect(args).not.toContain('--bcc');
  });

  it('creates the label only when it is missing', () => {
    const present = vi.fn((args: string[]) =>
      args.includes('list')
        ? JSON.stringify({ labels: [{ id: 'L1', name: 'assistant-replied' }] })
        : '',
    );
    gogRespondDeps(present, MAILBOX).ensureLabel('assistant-replied');
    expect(present).toHaveBeenCalledTimes(1);

    const missing = vi.fn((args: string[]) =>
      args.includes('list') ? JSON.stringify({ labels: [] }) : '',
    );
    gogRespondDeps(missing, MAILBOX).ensureLabel('assistant-replied');
    expect(missing).toHaveBeenLastCalledWith([
      'gmail',
      'labels',
      'create',
      'assistant-replied',
      '--account',
      MAILBOX,
    ]);

    const empty = vi.fn((_args: string[]) => '');
    gogRespondDeps(empty, MAILBOX).ensureLabel('assistant-replied');
    expect(empty).toHaveBeenCalledTimes(2);
  });

  it('applies the label to the thread', () => {
    const gog = vi.fn((_args: string[]) => '');
    gogRespondDeps(gog, MAILBOX).applyLabel('t1', 'assistant-replied');
    expect(gog).toHaveBeenCalledWith([
      'gmail',
      'thread',
      'modify',
      't1',
      '--add',
      'assistant-replied',
      '--account',
      MAILBOX,
    ]);
  });
});
