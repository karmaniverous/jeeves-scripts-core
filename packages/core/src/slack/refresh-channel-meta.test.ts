/**
 * Tests for the `slack-refresh-channel-meta` runnable through its live
 * wiring (`refresh-channel-meta.test-helper`): its manifest (disabled, a
 * dry run with no arguments), the skip with no `slack.channelMeta` block
 * (prerequisite and run), `doctor`'s check of what only the run can know,
 * previews through the live deps (with and without a worker result), and
 * a live run that writes the dated report, DMs the owner the summary and
 * fails the exit code on a partial run.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { readCoreManifests } from '../runnables/manifest.js';
import {
  jobDir,
  mocks,
  previewReport,
  PUBLIC,
  reportsDir,
  seedHome,
  today,
  useJobFixture,
} from './refresh-channel-meta.test-helper.js';

const helper = () => import('./refresh-channel-meta.test-helper.js');
vi.mock('../config/loader.js', async () => (await helper()).configMock());
vi.mock('../config/paths.js', async () => (await helper()).pathsMock());
vi.mock('../config/silo-router.js', async () => (await helper()).siloMock());
vi.mock('../lib/openclaw-config.js', async () =>
  (await helper()).openclawMock(),
);
vi.mock('../lib/component-config.js', async () =>
  (await helper()).componentConfigMock(),
);
vi.mock('../lib/slack-client.js', async (importOriginal) =>
  (await helper()).slackClientMock(importOriginal),
);
vi.mock('../lib/worker-slack/run.js', async () =>
  (await helper()).workerMock(),
);

const { default: job } = await import('./refresh-channel-meta.js');

useJobFixture();

const stateFile = () => path.join(jobDir(), 'state.json');

describe('slack-refresh-channel-meta runnable', () => {
  it('is in the slack domain with a disabled, dry-run daily manifest', () => {
    expect(job.id).toBe('slack-refresh-channel-meta');
    expect(job.domain).toBe('slack');
    expect(job.name).toBe('slack/refresh-channel-meta');
    const manifest = readCoreManifests().find(
      (m) => m.id === 'slack-refresh-channel-meta',
    );
    expect(manifest).toMatchObject({
      domain: 'slack',
      enabled: false,
      schedule: { freq: 'daily', byhour: 7, byminute: 0, timezone: 'UTC' },
      overlap_policy: 'skip',
      timeout_seconds: 2700,
      prerequisite: null,
    });
    // A dry run until the instance's enabling delta adds `--live`.
    expect(manifest).not.toHaveProperty('args');
  });

  it('skips with no slack.channelMeta block, by prerequisite and by run', async () => {
    mocks.block = undefined;
    expect(await job.prerequisite?.({ args: [] })).toBe(
      'no slack.channelMeta block in the instance config',
    );
    expect(await job.doctorCheck?.({ args: [] })).toBe(true);
    await job.run({ args: ['--live'] });
    expect(console.log).toHaveBeenCalledWith(
      '[skip] no slack.channelMeta block in the instance config',
    );
    expect(mocks.call).not.toHaveBeenCalled();
    expect(fs.existsSync(jobDir())).toBe(false);
  });

  it('passes its prerequisite with a block and its doctor check with a report target', async () => {
    expect(await job.prerequisite?.({ args: [] })).toBe(true);
    expect(await job.doctorCheck?.({ args: [] })).toBe(true);
  });

  it('fails the run, and doctor reports it, when the block has no report target', async () => {
    mocks.openclaw = {};
    expect(await job.prerequisite?.({ args: [] })).toBe(true);
    expect(await job.doctorCheck?.({ args: [] })).toContain(
      'no report target: set slack.channelMeta.reportChannel',
    );
    await expect(job.run({ args: ['--live'] })).rejects.toThrow(
      'commands.ownerAllowFrom',
    );
    expect(mocks.dispatchWithSlack).not.toHaveBeenCalled();
  });

  it("takes a report channel's homeDir as the report directory", async () => {
    mocks.block = {
      serverKey: 'scripts',
      timezone: 'UTC',
      reportChannel: 'C0ADMIN',
    };
    mocks.channels = { C0ADMIN: { homeDir: reportsDir() } };
    expect(await job.doctorCheck?.({ args: [] })).toBe(true);
  });

  it('previews through the live deps without --live: nothing set, written, posted or saved', async () => {
    await job.run({ args: [] });
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.postMessage).not.toHaveBeenCalled();
    expect(fs.existsSync(reportsDir())).toBe(false);
    expect(fs.existsSync(stateFile())).toBe(false);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining(
        'slack/refresh-channel-meta: preview: nothing set',
      ),
    );
    expect(previewReport()).toContain(
      '**No home directory** (1):\n\n- #general (`C1`)',
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('fails a preview whose worker result is unusable, opening no DM and deleting no run directory', async () => {
    seedHome();
    const runs = path.join(jobDir(), 'runs');
    const old = Array.from({ length: 15 }, (_, i) =>
      path.join(runs, `20200101-0000${String(i).padStart(2, '0')}`),
    );
    for (const dir of old) fs.mkdirSync(dir, { recursive: true });
    await job.run({ args: [] });
    expect(process.exitCode).toBe(1);
    expect(mocks.openDm).not.toHaveBeenCalled();
    expect(mocks.call).toHaveBeenCalledWith('users.info', { user: 'U0OWNER' });
    expect(mocks.postMessage).not.toHaveBeenCalled();
    for (const dir of old) expect(fs.existsSync(dir)).toBe(true);
    expect(fs.readdirSync(runs)).toHaveLength(16);
    expect(fs.existsSync(stateFile())).toBe(false);
  });

  it('previews with a real worker dispatch (its flags off, no post targets) and sets nothing', async () => {
    seedHome();
    mocks.dispatchWithSlack.mockImplementation((task) => {
      const file = /to `([^`]+result\.json)`/.exec(task)?.[1] ?? '';
      fs.writeFileSync(
        file,
        JSON.stringify({ channels: { C1: { description: 'About general' } } }),
      );
      return Promise.resolve({ task, posts: [], posted: 0 });
    });
    await job.run({ args: [] });
    const [, , slack, flags] = mocks.dispatchWithSlack.mock.calls[0] ?? [];
    expect(slack).toEqual({});
    expect(flags).toEqual({ dryRun: false, printTask: false });
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.postMessage).not.toHaveBeenCalled();
    expect(fs.existsSync(reportsDir())).toBe(false);
    expect(fs.existsSync(stateFile())).toBe(false);
    expect(previewReport()).toContain(
      '- #general (`C1`): empty\n  - current: (empty)\n  - proposed: \u201cAbout general\u201d',
    );
  });

  it('prints the TASK on --print-task (dispatch prints it) and sets nothing', async () => {
    seedHome();
    await job.run({ args: ['--print-task'] });
    const [task, , , flags] = mocks.dispatchWithSlack.mock.calls[0] ?? [];
    expect(task).toContain('- `C1`');
    expect(flags).toEqual({ dryRun: false, printTask: true });
    expect(mocks.postMessage).not.toHaveBeenCalled();
    expect(fs.existsSync(stateFile())).toBe(false);
  });

  it('writes the dated report, DMs the owner the summary, and fails the exit code when the worker\u2019s result is missing', async () => {
    seedHome();
    await job.run({ args: ['--live'] });
    const [task, options, slack, flags] =
      mocks.dispatchWithSlack.mock.calls[0] ?? [];
    expect(task).toContain('- `C1`');
    expect(options).toEqual({
      jobId: 'slack-refresh-channel-meta',
      thinking: 'low',
    });
    expect(slack).toEqual({});
    expect(flags).toEqual({ dryRun: false, printTask: false });
    expect(mocks.post).not.toHaveBeenCalled();
    const report = fs.readFileSync(
      path.join(reportsDir(), `${today()}.md`),
      'utf8',
    );
    expect(report).toContain('No values set: the worker wrote no result');
    expect(mocks.openDm).toHaveBeenCalledWith('U0OWNER');
    expect(mocks.postMessage).toHaveBeenCalledWith(
      'D0DM',
      expect.stringContaining('Worker result unusable: no values set'),
    );
    expect(mocks.postMessage).toHaveBeenCalledWith(
      'D0DM',
      expect.stringContaining(
        `Report: <${PUBLIC}|Slack channel meta report \u2014 ${today()}>`,
      ),
    );
    expect(process.exitCode).toBe(1);
    expect(fs.existsSync(stateFile())).toBe(true);
  });
});
