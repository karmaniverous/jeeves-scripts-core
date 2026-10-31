/**
 * `slack-refresh-channel-meta` and the real config loader (Decision 76):
 * with no loadable config, or no `slack.channelMeta` block, its
 * prerequisite and its run skip with exit 0 and `config check` passes;
 * with an invalid block, `config check` (the library check and the CLI's
 * instance check), its prerequisite and its run all fail; a block naming
 * a Slack account the gateway lacks fails `config check`, `doctor` and
 * the run.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { instanceConfigCheck } from '../cli/config-check.js';
import { configCheck } from '../config/check.js';
import { useConfigFile } from '../config/config-file.test-helper.js';
import { CONFIG_PATH_ENV, resetConfig } from '../config/loader.js';

vi.mock('../lib/openclaw-config.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  slackBotTokens: () => ({ default: 'secret-default', globex: 'secret-g' }),
}));

const { default: job } = await import('./refresh-channel-meta.js');

const REQUIRED = { timezone: 'UTC', serverKey: 'scripts' };

/** Run the job and say how it ended. */
const settle = async (): Promise<string> => {
  try {
    await job.run({ args: [], flags: { live: false, printTask: false } });
    return 'resolved';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

describe('slack-refresh-channel-meta and the instance config', () => {
  const write = useConfigFile();
  let outDir = '';
  beforeEach(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-meta-out-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(outDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it('skips with no loadable config', async () => {
    const saved = process.env[CONFIG_PATH_ENV];
    process.env[CONFIG_PATH_ENV] = path.join(outDir, 'missing.json');
    resetConfig();
    try {
      const reason = await job.prerequisite?.({ args: [] });
      expect(reason).toMatch(/^no loadable instance config \(/);
      expect(await settle()).toBe('resolved');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringMatching(/^\[skip\] no loadable instance config \(/),
      );
      expect(process.exitCode).toBeUndefined();
    } finally {
      process.env[CONFIG_PATH_ENV] = saved;
      resetConfig();
    }
  });

  it('passes config check and skips with no block', async () => {
    expect(configCheck(write({})).ok).toBe(true);
    expect(await job.prerequisite?.({ args: [] })).toBe(
      'no slack.channelMeta block in the instance config',
    );
    expect(await settle()).toBe('resolved');
    expect(console.log).toHaveBeenCalledWith(
      '[skip] no slack.channelMeta block in the instance config',
    );
  });

  it.each([
    ['no timezone', { serverKey: 'scripts' }, /slack\.channelMeta\.timezone/],
    [
      'a bad timezone',
      { ...REQUIRED, timezone: 'Mars/Base' },
      /timezone must be an IANA time zone/,
    ],
    [
      'no report directory for a DM',
      REQUIRED,
      /slack\.channelMeta\.outputDir is required: the report goes to a DM/,
    ],
    [
      'an unknown key',
      { ...REQUIRED, outputDir: '/srv/out', refs: {} },
      /Unrecognized key/,
    ],
  ])(
    'fails config check, its prerequisite and the run on %s',
    async (_what, block, message) => {
      const file = write({ slack: { channelMeta: block } });
      const result = configCheck(file);
      expect(result.ok).toBe(false);
      expect(result.errors.join('\n')).toMatch(message);
      const cli = await instanceConfigCheck(outDir, file.configPath, {
        loadPlugin: () => Promise.reject(new Error('not reached')),
      });
      expect(cli.ok).toBe(false);
      expect(cli.errors.join('\n')).toMatch(message);
      resetConfig();
      expect(() => job.prerequisite?.({ args: [] })).toThrow(message);
      expect(await settle()).toMatch(message);
    },
  );

  it('fails config check, doctor and the run on a Slack account the gateway lacks', async () => {
    const block = {
      ...REQUIRED,
      reportChannel: 'U0OWNER',
      outputDir: outDir,
      reportTextAccounts: ['globex', 'typo'],
    };
    const message =
      'slack.channelMeta.reportTextAccounts: "typo" is not a gateway Slack account (gateway Slack accounts: default, globex)';
    const file = write({ slack: { channelMeta: block } });
    expect(configCheck(file).errors).toEqual([message]);
    resetConfig();
    expect(await job.prerequisite?.({ args: [] })).toBe(true);
    expect(await job.doctorCheck?.({ args: [] })).toBe(message);
    expect(await settle()).toBe(message);
  });

  it('passes config check when every named account is the gateway\u2019s', () => {
    const file = write({
      slack: {
        channelMeta: {
          ...REQUIRED,
          outputDir: outDir,
          reportAccount: 'default',
          reportTextAccounts: ['globex'],
        },
      },
    });
    expect(configCheck(file)).toMatchObject({ ok: true, errors: [] });
  });

  it('takes the gateway accounts from its deps when given', () => {
    const file = write({
      slack: {
        channelMeta: { ...REQUIRED, outputDir: outDir, reportAccount: 'work' },
      },
    });
    expect(configCheck(file, { slackAccounts: () => ['work'] }).ok).toBe(true);
  });
});
