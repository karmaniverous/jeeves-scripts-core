/**
 * `admin-review-skill-proposals` and the real config loader (Decision
 * 76): with no loadable config, or no `skillReview` block, its
 * prerequisite and its run skip with exit 0 and `config check` passes;
 * with an invalid block, `config check` (the library check and the CLI's
 * instance check), its prerequisite and its run all fail; a
 * `reportAccount` the gateway lacks fails `config check`, `doctor` and
 * the run; gateway accounts that can't be read are a `config check`
 * warning, not a failure.
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
  slackBotTokens: () => ({ default: 'secret-default', work: 'secret-w' }),
}));

const { default: job } = await import('./review-skill-proposals.js');

const REQUIRED = {
  reportChannel: 'C0REVIEW',
  timezone: 'UTC',
  serverKey: 'scripts',
};
const NO_BLOCK = 'no skillReview block in the instance config';

/** Run the job and say how it ended. */
const settle = async (): Promise<string> => {
  try {
    await job.run({ args: [] });
    return 'resolved';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

describe('admin-review-skill-proposals and the instance config', () => {
  const write = useConfigFile();
  let outDir = '';
  beforeEach(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-review-out-'));
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
    expect(await job.prerequisite?.({ args: [] })).toBe(NO_BLOCK);
    expect(await settle()).toBe('resolved');
    expect(console.log).toHaveBeenCalledWith(`[skip] ${NO_BLOCK}`);
  });

  it.each([
    [
      'no timezone',
      { ...REQUIRED, timezone: undefined },
      /skillReview\.timezone/,
    ],
    [
      'a bad report channel',
      { ...REQUIRED, reportChannel: 'U0BOSS' },
      /reportChannel must be a Slack conversation id/,
    ],
    [
      'an out-of-range threshold',
      { ...REQUIRED, outputDir: '/srv/out', budgetAlertPercent: 101 },
      /skillReview\.budgetAlertPercent/,
    ],
    [
      'no report directory for a DM',
      { ...REQUIRED, reportChannel: 'D0DM' },
      /skillReview\.outputDir is required: the report goes to a DM/,
    ],
    [
      'no report directory for a channel without a homeDir',
      REQUIRED,
      /skillReview\.outputDir is required: the report channel C0REVIEW has no slack\.channels\.C0REVIEW\.homeDir/,
    ],
    [
      'an unknown key',
      { ...REQUIRED, outputDir: '/srv/out', slackChannel: 'C0REVIEW' },
      /Unrecognized key/,
    ],
  ])(
    'fails config check, its prerequisite and the run on %s',
    async (_what, block, message) => {
      const file = write({ skillReview: block });
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

  it('fails config check, doctor and the run on a reportAccount the gateway lacks', async () => {
    const message =
      'skillReview.reportAccount: "typo" is not a gateway Slack account (gateway Slack accounts: default, work)';
    const file = write({
      skillReview: { ...REQUIRED, outputDir: outDir, reportAccount: 'typo' },
    });
    expect(configCheck(file).errors).toEqual([message]);
    resetConfig();
    expect(await job.prerequisite?.({ args: [] })).toBe(true);
    expect(await job.doctorCheck?.({ args: [] })).toBe(message);
    expect(await settle()).toBe(message);
  });

  it("passes config check and doctor with the report channel's homeDir and the default account", async () => {
    const file = write({
      slack: { channels: { C0REVIEW: { homeDir: outDir } } },
      skillReview: REQUIRED,
    });
    expect(configCheck(file)).toMatchObject({ ok: true, errors: [] });
    resetConfig();
    expect(await job.doctorCheck?.({ args: [] })).toBe(true);
  });

  it('checks the account against the gateway accounts from its deps when given', () => {
    const file = write({
      skillReview: { ...REQUIRED, outputDir: outDir, reportAccount: 'other' },
    });
    expect(configCheck(file, { slackAccounts: () => ['other'] }).ok).toBe(true);
    expect(configCheck(file, { slackAccounts: () => ['default'] }).ok).toBe(
      false,
    );
  });

  // A host without OpenClaw (CI) can't read the gateway accounts: config
  // check warns and passes; the run still refuses.
  describe('when the gateway accounts cannot be read', () => {
    const unreadable = {
      slackAccounts: (): readonly string[] => {
        throw new Error('No Slack bot token found in OpenClaw config');
      },
    };
    const warning =
      "skillReview names Slack accounts, but the gateway's could not be read (No Slack bot token found in OpenClaw config); not checked here, the job checks them when it runs";

    it('config check passes with a warning, even for the default account', () => {
      const file = write({ skillReview: { ...REQUIRED, outputDir: outDir } });
      expect(configCheck(file, unreadable)).toMatchObject({
        ok: true,
        errors: [],
        warnings: [warning],
      });
    });

    it('a warning never hides a real problem', () => {
      const file = write({
        jobs: { 'email-poll': { silo: 'nowhere' } },
        skillReview: { ...REQUIRED, outputDir: outDir },
      });
      const result = configCheck(file, unreadable);
      expect(result.ok).toBe(false);
      expect(result.warnings).toEqual([warning]);
    });

    it('reads the accounts once and warns for nothing with no block naming one', () => {
      let reads = 0;
      const counting = {
        slackAccounts: () => {
          reads += 1;
          return ['default'];
        },
      };
      expect(
        configCheck(
          write({ skillReview: { ...REQUIRED, outputDir: outDir } }),
          counting,
        ),
      ).toMatchObject({ ok: true, warnings: [] });
      expect(reads).toBe(1);
      resetConfig();
      expect(
        configCheck(
          write({
            slack: {
              channelMeta: {
                ...REQUIRED,
                outputDir: outDir,
                reportTextAccounts: [],
              },
            },
          }),
          unreadable,
        ),
      ).toMatchObject({ ok: true, errors: [], warnings: [] });
    });

    it('warns for slack.channelMeta when it names an account', () => {
      const file = write({
        slack: {
          channelMeta: {
            ...REQUIRED,
            outputDir: outDir,
            reportAccount: 'work',
          },
        },
      });
      expect(configCheck(file, unreadable)).toMatchObject({
        ok: true,
        warnings: [
          "slack.channelMeta names Slack accounts, but the gateway's could not be read (No Slack bot token found in OpenClaw config); not checked here, the job checks them when it runs",
        ],
      });
    });

    it('the CLI prints the warning and OK, exit 0', async () => {
      const file = write({ skillReview: { ...REQUIRED, outputDir: outDir } });
      const { buildProgram } = await import('../cli/index.js');
      const openclaw = await import('../lib/openclaw-config.js');
      vi.spyOn(openclaw, 'slackBotTokens').mockImplementation(() => {
        throw new Error('No Slack bot token found in OpenClaw config');
      });
      const err = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      process.exitCode = undefined;
      await buildProgram({ root: path.dirname(file.configPath) }).parseAsync(
        ['config', 'check', '--config', file.configPath],
        { from: 'user' },
      );
      expect(err).toHaveBeenCalledWith(`warning: ${warning}`);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringMatching(/^config check: OK/),
      );
      expect(process.exitCode).toBeUndefined();
    });

    it('doctor shows the warning under an OK config line', async () => {
      const file = write({ skillReview: { ...REQUIRED, outputDir: outDir } });
      const { doctorReport } = await import('../cli/doctor.js');
      const openclaw = await import('../lib/openclaw-config.js');
      vi.spyOn(openclaw, 'slackBotTokens').mockImplementation(() => {
        throw new Error('No Slack bot token found in OpenClaw config');
      });
      const lines = await doctorReport(path.dirname(file.configPath), {
        nodeVersion: '24.22.2',
      });
      expect(lines).toContainEqual(expect.stringMatching(/^config: .*: OK$/));
      expect(lines).toContainEqual(
        expect.stringContaining(`warning: ${warning}`),
      );
    });
  });
});
