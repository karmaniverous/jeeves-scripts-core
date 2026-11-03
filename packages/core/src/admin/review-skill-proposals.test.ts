/**
 * Tests for the `admin-review-skill-proposals` runnable through its live
 * wiring: its manifest (disabled, a dry run with no arguments), the skip
 * with no loadable config or no `skillReview` block (prerequisite and
 * run), `doctor`'s check of what only the run can know, a quiet day and a
 * dry run through the live deps (the snapshot in a temp state directory,
 * the dispatch options and flags), `--live` and `--print-task` reaching the
 * dispatch as flags, and the live seams: gather, inventory,
 * budget, insider link and the post as `reportAccount`'s bot.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readCoreManifests } from '../runnables/manifest.js';
import { proposal } from './skill-review/review-flow.test-helper.js';
import type { CatalogBudgetEnv } from './skill-review/skills-status.js';

const mocks = vi.hoisted(() => {
  const postMessage = vi.fn().mockResolvedValue({ channel: 'C9', ts: '1' });
  const config: {
    loaded: string | null;
    block: Record<string, unknown> | undefined;
    channels: Record<string, { homeDir?: string }>;
  } = { loaded: null, block: undefined, channels: {} };
  return {
    ...config,
    stateDir: '',
    dispatchWithSlack:
      vi.fn<
        (
          task: string,
          options: unknown,
          slack: unknown,
          flags: unknown,
        ) => Promise<unknown>
      >(),
    gatherProposals: vi.fn(),
    readInventory: vi.fn(),
    measureCatalogBudget:
      vi.fn<(env: CatalogBudgetEnv, inventory: unknown) => Promise<unknown>>(),
    gatewayRpc: vi.fn(),
    resolveDist: vi.fn(() => '/g/node_modules/openclaw/dist'),
    postMessage,
    createSlackClient: vi.fn(() => ({ postMessage })),
    fetch: vi.fn(),
  };
});

vi.mock('../config/loader.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getLoadedConfigPath: () => mocks.loaded,
  resolveConfig: () => {
    throw new Error('no jeeves-scripts.json found');
  },
  loadConfig: () => ({
    slack: { channels: mocks.channels },
    skillReview: mocks.block,
  }),
}));
vi.mock('../config/paths.js', () => ({
  paths: () => ({ stateDir: mocks.stateDir }),
}));
vi.mock('../lib/openclaw-config.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openclawStateDirs: () => ['/oc-state', '/legacy'],
  findInOpenclawConfig: (pick: (c: unknown) => unknown) =>
    pick({ from: 'openclaw' }),
  slackBotTokens: () => ({ default: 'xoxb-default', work: 'xoxb-work' }),
  slackBotToken: (account = 'default') => `xoxb-${account}`,
}));
vi.mock('../lib/component-config.js', () => ({
  readComponentConfig: () => ({ port: 1934, keys: { scripts: 'seed' } }),
}));
vi.mock('../lib/worker-slack/run.js', () => ({
  dispatchWithSlack: mocks.dispatchWithSlack,
}));
vi.mock('../lib/slack-client.js', () => ({
  createSlackClient: mocks.createSlackClient,
}));
vi.mock('../lib/gateway-rpc.js', () => ({
  gatewayRpc: mocks.gatewayRpc,
  resolveOpenClawCli: () => '/g/node_modules/openclaw/openclaw.mjs',
}));
vi.mock('./lib/resolve-openclaw-dist.js', () => ({
  resolveOpenClawDist: mocks.resolveDist,
}));
vi.mock('./skill-review/proposals.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  gatherProposals: mocks.gatherProposals,
}));
vi.mock('./skill-review/inventory.js', () => ({
  readInventory: mocks.readInventory,
}));
vi.mock('./skill-review/skills-status.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  measureCatalogBudget: mocks.measureCatalogBudget,
  liveHomeDirs: () => ['/home-a'],
}));

const { default: job } = await import('./review-skill-proposals.js');
const { liveReviewDeps, NO_BLOCK } = await import('./skill-review/live.js');

const HOME = path.resolve('/home-dir');
const LABEL = 'admin/review-skill-proposals';
const UNMEASURED = `[warn] ${LABEL}: skills catalog budget unavailable: not measured`;

const PROPOSAL = proposal('p-1');

/** jeeves-server's resolve-path answers with `publicUrl`. */
const serverLinks = (publicUrl: string) =>
  mocks.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ publicUrl }),
  });

beforeEach(() => {
  mocks.stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-review-'));
  mocks.loaded = '/instance/jeeves-scripts.json';
  mocks.block = {
    reportChannel: 'C9',
    reportAccount: 'default',
    timezone: 'UTC',
    serverKey: 'scripts',
    budgetAlertPercent: 90,
  };
  mocks.channels = { C9: { homeDir: HOME } };
  mocks.gatherProposals.mockResolvedValue([]);
  mocks.readInventory.mockReturnValue([]);
  mocks.measureCatalogBudget.mockRejectedValue(new Error('not measured'));
  mocks.dispatchWithSlack.mockResolvedValue({ task: '', posts: [], posted: 0 });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  // Never reach a real jeeves-server.
  mocks.fetch.mockReset();
  mocks.fetch.mockRejectedValue(new Error('fetch not stubbed for this test'));
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(mocks.stateDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('admin-review-skill-proposals runnable', () => {
  it('is in the admin domain with a disabled, dry-run daily manifest', () => {
    expect(job.id).toBe('admin-review-skill-proposals');
    expect(job.domain).toBe('admin');
    expect(job.name).toBe(LABEL);
    const manifest = readCoreManifests().find(
      (m) => m.id === 'admin-review-skill-proposals',
    );
    expect(manifest).toMatchObject({
      domain: 'admin',
      enabled: false,
      schedule: { freq: 'daily', byhour: 6, byminute: 0, timezone: 'UTC' },
      overlap_policy: 'skip',
      timeout_seconds: 2700,
      prerequisite: null,
    });
    // A dry run until the instance's enabling delta adds `--live`.
    expect(manifest).not.toHaveProperty('args');
  });

  it('skips with no skillReview block, by prerequisite and by run', async () => {
    mocks.block = undefined;
    expect(await job.prerequisite?.({ args: [] })).toBe(NO_BLOCK);
    expect(NO_BLOCK).toBe('no skillReview block in the instance config');
    expect(await job.doctorCheck?.({ args: [] })).toBe(true);
    await job.run({ args: ['--live'] });
    expect(console.log).toHaveBeenCalledWith(`[skip] ${NO_BLOCK}`);
    expect(mocks.gatherProposals).not.toHaveBeenCalled();
  });

  it('skips with no loadable instance config', async () => {
    mocks.loaded = null;
    expect(await job.prerequisite?.({ args: [] })).toBe(
      'no loadable instance config (no jeeves-scripts.json found)',
    );
    await job.run({ args: ['--live'] });
    expect(mocks.gatherProposals).not.toHaveBeenCalled();
  });

  it('passes its prerequisite and doctor check with complete settings', async () => {
    expect(await job.prerequisite?.({ args: [] })).toBe(true);
    expect(await job.doctorCheck?.({ args: [] })).toBe(true);
  });

  it('fails the run, and doctor reports it, when the report channel has no homeDir', async () => {
    mocks.channels = {};
    const problem =
      'skillReview.outputDir is required: the report channel C9 has no slack.channels.C9.homeDir';
    expect(await job.prerequisite?.({ args: [] })).toBe(true);
    expect(await job.doctorCheck?.({ args: [] })).toBe(problem);
    await expect(job.run({ args: ['--live'] })).rejects.toThrow(problem);
    expect(mocks.gatherProposals).not.toHaveBeenCalled();
  });

  it('runs the flow with the live deps (quiet day)', async () => {
    await job.run({ args: [] });
    expect(mocks.gatherProposals).toHaveBeenCalledOnce();
    expect(console.log).toHaveBeenCalledWith(
      `[skip] ${LABEL}: no pending Workshop proposals`,
    );
    expect(console.log).toHaveBeenCalledWith(UNMEASURED);
    expect(mocks.dispatchWithSlack).not.toHaveBeenCalled();
    expect(mocks.postMessage).not.toHaveBeenCalled();
  });

  it('dry-runs with the live deps: snapshot in the state dir, the dispatch options and flags, the homeDir report', async () => {
    mocks.gatherProposals.mockResolvedValue([PROPOSAL]);
    await job.run({ args: [] });
    const runs = fs.readdirSync(
      path.join(mocks.stateDir, 'admin', 'skill-review', 'runs'),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatch(/^\d{8}-\d{6}$/);
    const [task, options, slack, flags] =
      mocks.dispatchWithSlack.mock.calls[0] ?? [];
    expect(task).toContain('`p-1`');
    expect(options).toEqual({
      jobId: 'admin-review-skill-proposals',
      thinking: 'medium',
    });
    expect(slack).toEqual({});
    expect(flags).toStrictEqual({ dryRun: true, printTask: false });
    expect(mocks.postMessage).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(UNMEASURED);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(
        /preview only; the report would go to .*home-dir.*\.md \(homeDir\)$/,
      ),
    );
  });

  it.each([
    // The mocked worker writes no report, so a live run fails after dispatch.
    ['--live', { dryRun: false, printTask: false }, /report/i],
    ['--print-task', { dryRun: true, printTask: true }, /^done$/],
  ])('passes %s to the dispatch as %j', async (arg, flags, outcome) => {
    mocks.gatherProposals.mockResolvedValue([PROPOSAL]);
    serverLinks('https://jeeves.test/browse/r.md');
    const [ran] = await Promise.allSettled([job.run({ args: [arg] })]);
    expect(ran.status === 'rejected' ? String(ran.reason) : 'done').toMatch(
      outcome,
    );
    expect(mocks.dispatchWithSlack).toHaveBeenCalledOnce();
    expect(mocks.dispatchWithSlack.mock.calls[0]?.[3]).toStrictEqual(flags);
    expect(mocks.postMessage).not.toHaveBeenCalled();
  });
});

describe('live wiring', () => {
  it('gathers from the OpenClaw state dir, config and global modules', async () => {
    const deps = liveReviewDeps();
    deps.readInventory();
    expect(mocks.readInventory).toHaveBeenCalledWith(
      expect.objectContaining({
        stateDir: '/oc-state',
        globalModulesDir: path.dirname(
          path.dirname('/g/node_modules/openclaw/dist'),
        ),
        homeDir: os.homedir(),
        openclawConfig: { from: 'openclaw' },
      }),
    );
    await deps.gatherProposals();
    expect(mocks.gatherProposals).toHaveBeenCalledWith(
      expect.objectContaining({ stateDir: '/oc-state' }),
    );
    expect(
      deps.readText(path.join(import.meta.dirname, 'missing.txt')),
    ).toBeUndefined();
    expect(deps.runsRoot).toBe(
      path.join(mocks.stateDir, 'admin', 'skill-review', 'runs'),
    );
  });

  it("returns the settings' skip as a problem to the flow", () => {
    mocks.block = undefined;
    expect(liveReviewDeps().settings()).toEqual({ problem: NO_BLOCK });
  });

  it.each([
    ['a Windows drive path', 'J:\\out\\2026-10-20.md', 'j/out'],
    ['a POSIX path', '/srv/out/2026-10-20.md', 'srv/out'],
  ])(
    'asks jeeves-server (local API, named machine key) for the insider link: %s',
    async (_case, file, browse) => {
      const publicUrl = `https://jeeves.test/browse/${browse}/2026-10-20.md`;
      serverLinks(publicUrl);
      const link = await liveReviewDeps().reportLink(file, 'scripts');
      expect(link).toBe(
        `<${publicUrl}|Skill Workshop review \u2014 2026-10-20>`,
      );
      expect(String(mocks.fetch.mock.calls[0]?.[0])).toMatch(
        /^http:\/\/127\.0\.0\.1:1934\/api\/resolve-path\?fsPath=.+&k=[0-9a-f]{32}$/,
      );
    },
  );

  it('measures the budget through gatewayRpc with a 60 s wait, the OpenClaw config and home dirs', async () => {
    const inventory: never[] = [];
    mocks.measureCatalogBudget.mockResolvedValue({ chars: 1 });
    await expect(liveReviewDeps().catalogBudget(inventory)).resolves.toEqual({
      chars: 1,
    });
    const [env, passed] = mocks.measureCatalogBudget.mock.calls[0] ?? [];
    expect(env).toMatchObject({
      openclawConfig: { from: 'openclaw' },
      homeDirs: ['/home-a'],
    });
    expect(passed).toBe(inventory);
    mocks.gatewayRpc.mockResolvedValue({ ok: 1 });
    await expect(env?.rpc('skills.status', {})).resolves.toEqual({ ok: 1 });
    expect(mocks.gatewayRpc).toHaveBeenCalledWith(
      'skills.status',
      {},
      '/g/node_modules/openclaw/openclaw.mjs',
      { waitMs: 60_000 },
    );
  });

  it("posts as the given account's bot", async () => {
    await liveReviewDeps().postToSlack('C9', 'hello', 'work');
    expect(mocks.createSlackClient).toHaveBeenCalledWith({
      token: 'xoxb-work',
    });
    expect(mocks.postMessage).toHaveBeenCalledWith('C9', 'hello');
  });
});
