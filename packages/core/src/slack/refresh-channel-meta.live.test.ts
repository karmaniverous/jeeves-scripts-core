/**
 * Tests for the runnable's live deps (`channel-meta/live`, through
 * `refresh-channel-meta.test-helper`): account order, workspace reading
 * with each token and scope capture, the report link from jeeves-server
 * (the insider key from the machine key's seed), applying a value and
 * reading history with the workspace client, and the state and run
 * folders under `{stateDir}/slack/channel-meta/`.
 */

import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  jobDir,
  mocks,
  PUBLIC,
  reportsDir,
  urlOf,
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

const { accountOrder, liveRefreshDeps, liveSettings, liveWorkspaces } =
  await import('./channel-meta/live.js');

useJobFixture();

/** `computeInsiderKey('seed-a')`. */
const SEED_A_INSIDER = '99cc33756dcb5257d935fec22da2496d';

describe('live wiring', () => {
  it('reads accounts default first, each with its own token and a scope-capturing fetch', async () => {
    expect(accountOrder(['b', 'default', 'a'])).toEqual(['default', 'a', 'b']);
    expect(accountOrder(['default', 'z'])).toEqual(['default', 'z']);
    expect(accountOrder(['z', 'default'])).toEqual(['default', 'z']);
    mocks.fetch.mockResolvedValue(
      new Response('{}', {
        headers: [[['x', 'oauth', 'scopes'].join('-'), 'channels:read']],
      }),
    );
    const workspaces = await liveWorkspaces();
    expect(workspaces.map((w) => [w.account, w.team])).toEqual([
      ['default', 'Acme'],
      ['vc', 'Acme'],
    ]);
    expect(mocks.clientOptions.map((o) => o.token)).toEqual([
      'secret-default',
      'secret-vc',
    ]);
    await mocks.clientOptions[0]?.fetch?.('https://slack.com/api/auth.test');
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://slack.com/api/auth.test',
      undefined,
    );
  });

  it("resolves the report link through jeeves-server's local API with the insider key", async () => {
    const file = path.join(reportsDir(), '2026-10-22.md');
    const link = await liveRefreshDeps().reportLink(file, 'scripts');
    expect(link).toBe(
      `<${PUBLIC}|Slack channel meta report \u2014 2026-10-22>`,
    );
    const url = new URL(urlOf(mocks.fetch.mock.calls[0]?.[0] ?? ''));
    expect(url.origin + url.pathname).toBe(
      'http://127.0.0.1:1934/api/resolve-path',
    );
    expect(url.searchParams.get('fsPath')).toBe(file);
    expect(url.searchParams.get('k')).toBe(SEED_A_INSIDER);
  });

  it('applies with the workspace client and reads history through it', async () => {
    const deps = liveRefreshDeps();
    const [ws] = await liveWorkspaces();
    if (!ws) throw new Error('no workspace');
    mocks.post.mockResolvedValue({});
    mocks.call.mockResolvedValue({ channel: { topic: { value: 'T' } } });
    expect(await deps.apply(ws, 'C1', 'topic', 'T')).toEqual({
      ok: true,
      value: 'T',
      verified: true,
    });
    expect(mocks.post).toHaveBeenCalledWith('conversations.setTopic', {
      channel: 'C1',
      topic: 'T',
    });
    mocks.call.mockResolvedValue({ messages: [] });
    const read = await deps.history(ws, 'C1', undefined);
    expect(read).toEqual({ messages: [], truncated: false });
    expect(mocks.call).toHaveBeenLastCalledWith('conversations.history', {
      channel: 'C1',
      limit: '200',
      oldest: '0',
    });
  });

  it('keeps state and runs under {stateDir}/slack/channel-meta', () => {
    const deps = liveRefreshDeps();
    expect(deps.runsRoot).toBe(path.join(jobDir(), 'runs'));
    expect(deps.loadState()).toEqual({ version: 1, channels: {} });
    deps.saveState({ version: 1, channels: {}, reportHash: 'h' });
    expect(deps.loadState().reportHash).toBe('h');
    expect(deps.homeDirOf('C9')).toBeUndefined();
    expect(deps.archiveRoots()).toEqual([mocks.slackRoot]);
    expect(deps.now()).toBeInstanceOf(Date);
  });

  it('resolves the settings from the block, and none without one', () => {
    expect(liveSettings()).toMatchObject({
      reportChannel: 'U0OWNER',
      reportChannelSource: 'owner',
      outputDir: reportsDir(),
      serverKeyName: 'scripts',
      pathRoots: { host: path },
    });
    expect(liveRefreshDeps().settings()).toMatchObject({
      reportChannel: 'U0OWNER',
    });
    mocks.block = undefined;
    expect(liveSettings()).toBeUndefined();
    expect(liveRefreshDeps().settings()).toEqual({
      problem: 'no slack.channelMeta block in the instance config',
    });
  });
});
