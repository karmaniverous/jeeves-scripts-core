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

import { getGmailAccounts } from '../config/index.js';
import { resetConfig } from '../config/loader.js';
import { parseRunnableArgs } from '../lib/args.js';
import emailApplyLabelsJob, {
  applyLabelsFlags,
  emailApplyLabels,
  formatApplyLabels,
} from './email-apply-labels.js';
import { setThreadState } from './email-state.js';
import type { ApplyLabelsClient } from './google-workspace/apply-labels.js';

const flagsOf = (args: string[]) => parseRunnableArgs(args, applyLabelsFlags);

const A = 'me@example.com';
const B = 'ops@example.com';

let dir: string;
let configPath: string;

const writeConfig = (
  reportOnly: boolean,
  accounts: { email: string; reportOnly?: boolean }[] = [{ email: A }],
) => {
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      instance: { name: 'test', baseDir: '/base' },
      pipeline: {
        accounts: accounts.map((a) => ({
          ...a,
          type: 'gmail',
          emailPolling: true,
        })),
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
  emailApplyLabels(flagsOf(['--config', configPath, ...args]), {
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
    emailApplyLabels(flagsOf(['--config', configPath]), { client: factory });
    expect(process.exitCode).toBe(1);
    expect(factory).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('every target account is report-only'),
    );
  });

  it('refuses when the one target account is report-only on its own', () => {
    writeConfig(false, [{ email: A, reportOnly: true }, { email: B }]);
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const factory = vi.fn();
    emailApplyLabels(flagsOf(['--config', configPath, '--account', A]), {
      client: factory,
    });
    expect(process.exitCode).toBe(1);
    expect(factory).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('every target account is report-only'),
    );
  });

  it('skips a report-only account and catches up the others', () => {
    writeConfig(false, [{ email: A, reportOnly: true }, { email: B }]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { client, enqueue } = fakeClient();
    run([], client);
    expect(process.exitCode).toBeUndefined();
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
      expect.objectContaining({ account: B }),
      expect.objectContaining({ account: B }),
    ]);
    expect(log).toHaveBeenCalledWith(`${A}: report-only, skipped`);
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

  it('honours --config even when another config is already cached', () => {
    writeConfig(false);
    // An instance plugin with a local schema caches the instance config
    // at registration; the shared test config (no Gmail accounts) stands in.
    expect(getGmailAccounts()).toEqual([]);
    const { client, enqueue } = fakeClient();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    run(['--account', A], client);
    expect(process.exitCode).toBeUndefined();
    expect(enqueue).toHaveBeenCalled();
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
  ])('rejects %s %s with exit code 1, opening nothing', (flag, value) => {
    writeConfig(false);
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const factory = vi.fn();
    emailApplyLabels(flagsOf(['--config', configPath, flag, value]), {
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
        accounts: [
          { account: A, reportOnly: false, scanned: 3, threads: 0, labels: {} },
        ],
        labels: 0,
        truncated: true,
      }),
    ).toEqual([
      `${A}: 0 of 3 threads need labels`,
      'apply-labels: enqueued 0 labels; drain-updates applies them',
      'apply-labels: stopped at --max; run again to continue',
    ]);
  });

  it('marks a report-only account in a dry run', () => {
    expect(
      formatApplyLabels({
        dryRun: true,
        accounts: [
          {
            account: A,
            reportOnly: true,
            scanned: 1,
            threads: 1,
            labels: { receipt: 1 },
          },
        ],
        labels: 1,
        truncated: false,
      })[0],
    ).toBe(
      `${A}: 1 of 1 threads need labels (receipt 1); report-only, skipped outside a dry run`,
    );
  });
});
