/**
 * Tests for the `email-apply-labels` runnable: reportOnly refusal and
 * dry run, account and option validation, wiring to applyPendingLabels,
 * and the summary lines. Config is a temp file; the runner client is a
 * fake.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetConfig } from '../config/loader.js';
import emailApplyLabelsJob, {
  emailApplyLabels,
  formatApplyLabels,
} from './email-apply-labels.js';
import { setThreadState } from './email-state.js';
import type { ApplyLabelsClient } from './google-workspace/apply-labels.js';

const A = 'me@example.com';

let dir: string;
let configPath: string;

const writeConfig = (reportOnly: boolean) => {
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      instance: { name: 'test', baseDir: '/base' },
      pipeline: {
        accounts: [{ email: A, type: 'gmail', emailPolling: true }],
        buckets: { domains: [], priority: ['clients'] },
        refs: {},
        emailConfig: { reportOnly, digest: { slackChannelId: '' } },
      },
    }),
  );
  resetConfig();
};

const fakeClient = () => {
  const items = new Map<string, string>();
  const enqueue = vi.fn(() => 1);
  const close = vi.fn();
  const client: ApplyLabelsClient & { close(): void } = {
    getItem: (_ns, _key, item) => items.get(item) ?? null,
    setItem: (_ns, _key, item, value) => void items.set(item, value ?? ''),
    listItemKeys: () => [...items.keys()],
    enqueue,
    close,
  };
  setThreadState(client, A, 't1', {
    receiptCandidate: true,
    bucket: 'clients',
    date: '2026-10-02',
  });
  return { client, enqueue, close };
};

const run = (args: string[], client = fakeClient().client) => {
  emailApplyLabels(['--config', configPath, ...args], {
    client: () => client,
  });
};

describe('email-apply-labels', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-apply-labels-'));
    configPath = path.join(dir, 'jeeves-scripts.json');
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
    resetConfig();
    process.exitCode = undefined;
  });

  it('refuses while reportOnly is on, without opening the store', () => {
    writeConfig(true);
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const factory = vi.fn();
    emailApplyLabels(['--config', configPath], { client: factory });
    expect(process.exitCode).toBe(1);
    expect(factory).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('reportOnly is on'),
    );
  });

  it('allows a dry run while reportOnly is on', () => {
    writeConfig(true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { client, enqueue, close } = fakeClient();
    run(['--dry-run'], client);
    expect(enqueue).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      'apply-labels: would enqueue 2 labels (dry run)',
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('enqueues pending labels once reportOnly is off', () => {
    writeConfig(false);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { client, enqueue } = fakeClient();
    run(['--account', A, '--since', '2000-01-01', '--max', '10'], client);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(
      `${A}: 1 of 1 threads need labels (receipt 1, clients 1)`,
    );
  });

  it('rejects an account that is not a configured Gmail account', () => {
    writeConfig(false);
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    run(['--account', 'nobody@example.com']);
    expect(process.exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('is not a configured Gmail account'),
    );
  });

  it.each([
    ['--since', 'yesterday-ish'],
    ['--max', '0'],
    ['--max', '2.5'],
    ['--bogus', 'x'],
  ])('rejects %s %s with exit code 1, opening nothing', (flag, value) => {
    writeConfig(false);
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const factory = vi.fn();
    emailApplyLabels(['--config', configPath, flag, value], {
      client: factory,
    });
    expect(process.exitCode).toBe(1);
    expect(factory).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/^apply-labels: /),
    );
  });

  it('is the email-domain runnable email-apply-labels', () => {
    expect(emailApplyLabelsJob).toMatchObject({
      id: 'email-apply-labels',
      domain: 'email',
    });
  });
});

describe('formatApplyLabels', () => {
  it('reports a truncated run', () => {
    expect(
      formatApplyLabels({
        dryRun: false,
        accounts: [{ account: A, scanned: 3, threads: 0, labels: {} }],
        labels: 0,
        truncated: true,
      }),
    ).toEqual([
      `${A}: 0 of 3 threads need labels`,
      'apply-labels: enqueued 0 labels; drain-updates applies them',
      'apply-labels: stopped at --max; run again to continue',
    ]);
  });
});
