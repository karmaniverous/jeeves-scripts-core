/**
 * Tests for meeting extraction over a temp archive (`useTempConfig`) and the
 * in-memory runner: candidate scan, detection, the meeting package, label
 * actions, dedup and the reportOnly deferral and catch-up.
 */

import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getEmailBaseForAccount } from '../config/index.js';
import { getThreadsPath } from '../email/email-cache.js';
import { fakeRunnerClient } from '../lib/fake-runner-client.test-helper.js';
import { useTempConfig } from '../lib/temp-config.test-helper.js';
import { type ExtractDeps, extractDeps, extractMeetings } from './extract.js';

useTempConfig();
const ACCOUNT = 'me@example.com';
let runner: ReturnType<typeof fakeRunnerClient>;
let logs: string[];

const thread = (
  threadId: string,
  subject: string,
  messages: Record<string, { from: string; body?: string; labels?: string[] }>,
) => {
  const dir = getThreadsPath(ACCOUNT, threadId);
  fs.mkdirSync(dir, { recursive: true });
  const cache: Record<string, unknown> = {};
  for (const [id, m] of Object.entries(messages)) {
    cache[id] = {
      from: m.from,
      snippet: '',
      date: '2026-03-02T10:00:00Z',
      internalDateMs: Date.parse('2026-03-02T10:00:00Z'),
      labels: m.labels ?? ['INBOX'],
    };
    if (m.body !== undefined)
      fs.writeFileSync(
        path.join(dir, `${id}.json`),
        JSON.stringify({ body: { text: m.body } }),
      );
  }
  fs.writeFileSync(
    path.join(dir, 'thread.json'),
    JSON.stringify({ threadId, subject, messages: cache }),
  );
};

const deps = (over: Partial<ExtractDeps> = {}): ExtractDeps => ({
  settings: () => ({ accounts: [ACCOUNT], reportOnly: false, archive: true }),
  runner: () => runner.client,
  now: () => '2026-03-03T00:00:00.000Z',
  ...over,
});

beforeEach(() => {
  runner = fakeRunnerClient();
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(' '));
  });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  fs.rmSync(path.join(getEmailBaseForAccount(ACCOUNT), 'threads'), {
    recursive: true,
    force: true,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('extractMeetings', () => {
  it('stops when the settings cannot be read', () => {
    extractMeetings(
      deps({
        settings: () => {
          throw new Error('bad pipeline');
        },
      }),
    );
    expect(runner.closed()).toBe(false);
  });

  it('records a Gemini meeting, queues its label actions and skips it next time', () => {
    thread('t1', 'Notes: Weekly sync', {
      m1: {
        from: 'Gemini <gemini-notes@google.com>',
        body: 'Notes https://docs.google.com/document/d/abc123/edit with Jane Doe',
      },
    });
    extractMeetings(deps());
    expect(logs.some((l) => /^\[meetings\] ADDED .* \[gemini\] /.test(l))).toBe(
      true,
    );
    expect(runner.client.countItems('meetings', 'index')).toBe(1);
    expect(
      runner.client.hasItem('meetings', 'processedThreads', 'gemini:t1:m1'),
    ).toBe(true);
    expect([...runner.queues.values()].flat().length).toBeGreaterThan(0);
    expect(logs).toContain('[meetings] Index: 1 meetings total (runner state)');
    expect(runner.closed()).toBe(true);

    logs = [];
    extractMeetings(deps());
    expect(logs.find((l) => l.startsWith('[meetings] Done:'))).toContain(
      'added=0 skipped=1',
    );
  });

  it('skips messages not yet archived, marks non-meetings and ignores non-candidates', () => {
    thread('t2', 'Meeting notes pending', {
      m1: { from: 'gemini-notes@google.com' },
    });
    thread('t3', 'Weekly digest', {
      m1: { from: 'Apollo <news@apollo.io>', body: 'promo' },
    });
    thread('t4', 'Lunch?', { m1: { from: 'friend@example.com', body: 'hi' } });
    extractMeetings(deps());
    expect(logs).toContain('[meetings] SKIP t2/m1 \u2014 not yet in archive');
    expect(
      runner.client.hasItem(
        'meetings',
        'processedThreads',
        'not-meeting:t3:m1',
      ),
    ).toBe(true);
    expect(logs.find((l) => l.startsWith('[meetings] Done:'))).toContain(
      'scanned=2',
    );
  });

  it('defers label actions under reportOnly and catches up once it is off', () => {
    thread('t5', 'Notes: Planning', {
      m1: {
        from: 'gemini-notes@google.com',
        body: 'https://docs.google.com/document/d/zz9/edit',
      },
    });
    extractMeetings(
      deps({
        settings: () => ({
          accounts: [ACCOUNT],
          reportOnly: true,
          archive: false,
        }),
      }),
    );
    expect(logs).toContain(
      '[meetings] reportOnly: Gmail label actions deferred, not enqueued',
    );
    expect(logs.find((l) => l.startsWith('[meetings] Done:'))).toContain(
      'queued=0 deferred=1',
    );
    logs = [];
    extractMeetings(
      deps({
        settings: () => ({
          accounts: [ACCOUNT],
          reportOnly: false,
          archive: false,
        }),
      }),
    );
    expect(logs).toContain(
      '[meetings] emailConfig.meetings.archive is false: label only',
    );
    expect(
      logs.some((l) =>
        l.startsWith('[meetings] reportOnly catch-up: 1 meetings'),
      ),
    ).toBe(true);
  });
});

describe('extractDeps', () => {
  it('reads the accounts and email settings from config', () => {
    expect(extractDeps().settings()).toEqual({
      accounts: [],
      reportOnly: true,
      archive: true,
    });
  });
});
