/**
 * @module slack/refresh-channel-meta.test-helper
 *
 * Shared live-wiring harness for the `slack-refresh-channel-meta`
 * runnable tests: the mocks behind core's config (the `slack.channelMeta`
 * block, `slack.channels`, `paths`, the Slack archive), the OpenClaw
 * config (tokens, owner), jeeves-server's config, the Slack client and
 * `dispatchWithSlack` ({@link mocks}); a `fetch` that answers only
 * jeeves-server's resolve-path; state and reports in a temp folder
 * ({@link useJobFixture}). Each test file registers the module mocks
 * itself (`vi.mock` is hoisted per file) with the factories here.
 * Test-only.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, vi } from 'vitest';

import {
  type SlackChannelMetaBlock,
  slackChannelMetaSchema,
} from '../config/slack-schema.js';

const createMocks = () => ({
  block: undefined as Record<string, unknown> | undefined,
  channels: {} as Record<string, { homeDir?: string }>,
  openclaw: {} as unknown,
  stateDir: '',
  slackRoot: '',
  dispatchWithSlack:
    vi.fn<
      (
        task: string,
        options: unknown,
        slack: unknown,
        flags: unknown,
      ) => Promise<unknown>
    >(),
  clientOptions: [] as { token: string; fetch?: typeof fetch }[],
  call: vi.fn<
    (
      method: string,
      params?: Record<string, string>,
    ) => Promise<Record<string, unknown>>
  >(),
  post: vi.fn<
    (
      method: string,
      body: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>
  >(),
  postMessage: vi.fn(() => Promise.resolve({ channel: 'C', ts: '1.1' })),
  openDm: vi.fn(() => Promise.resolve('D0DM')),
  fetch: vi.fn<typeof fetch>(),
});

/** The job's mocked collaborators. */
export const mocks = createMocks();

/** The instance config the mocked loader returns (the block validated). */
export const configMock = () => ({
  loadConfig: () => ({
    slack: {
      channels: mocks.channels,
      ...(mocks.block === undefined
        ? {}
        : {
            channelMeta: slackChannelMetaSchema.parse(
              mocks.block,
            ) satisfies SlackChannelMetaBlock,
          }),
    },
  }),
});

/** `paths()` with the temp state folder. */
export const pathsMock = () => ({
  paths: () => ({ stateDir: mocks.stateDir }),
});

/** The Slack archive's entity directories. */
export const siloMock = () => ({ getEntityDirs: () => [mocks.slackRoot] });

/** Two gateway Slack accounts and the OpenClaw owner. */
export const openclawMock = () => ({
  slackBotTokens: () => ({
    globex: 'secret-globex',
    default: 'secret-default',
  }),
  findInOpenclawConfig: <T>(pick: (config: unknown) => T | undefined) =>
    pick(mocks.openclaw),
});

/** jeeves-server's own config: its port and the machine key. */
export const componentConfigMock = () => ({
  readComponentConfig: () => ({ port: 1934, keys: { scripts: 'seed-a' } }),
});

/** The Slack client, recording the options it was created with. */
export const slackClientMock = async (
  importOriginal: <T>() => Promise<T>,
): Promise<object> => ({
  ...(await importOriginal<object>()),
  createSlackClient: (options: { token: string; fetch?: typeof fetch }) => {
    mocks.clientOptions.push(options);
    return {
      call: mocks.call,
      post: mocks.post,
      postMessage: mocks.postMessage,
      openDm: mocks.openDm,
    };
  },
});

/** The worker dispatch. */
export const workerMock = () => ({
  dispatchWithSlack: mocks.dispatchWithSlack,
});

/** The insider URL the fake jeeves-server gives. */
export const PUBLIC = 'https://jeeves.example/browse/reports/x.md';

/** A fetch input's URL. */
export const urlOf = (input: string | URL | Request): string =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;

/** jeeves-server's resolve-path answers; every other fetch is refused. */
const serverFetch = (input: string | URL | Request): Promise<Response> =>
  urlOf(input).includes('/api/resolve-path')
    ? Promise.resolve(Response.json({ publicUrl: PUBLIC }))
    : Promise.reject(new Error('fetch not stubbed for this test'));

/** The report directory (temp). */
export const reportsDir = (): string => path.join(mocks.stateDir, 'reports');

/** The job's state and run folder. */
export const jobDir = (): string =>
  path.join(mocks.stateDir, 'slack', 'channel-meta');

/** Give C1 a home directory with a seeded meta. */
export const seedHome = (): void => {
  const home = path.join(mocks.stateDir, 'home');
  fs.mkdirSync(path.join(home, '.meta'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.meta', 'meta.json'),
    '{"_content":"About"}',
  );
  mocks.channels = { C1: { homeDir: home } };
};

/** A preview's report, in its only run directory. */
export const previewReport = (): string => {
  const runs = path.join(jobDir(), 'runs');
  const [run] = fs.readdirSync(runs);
  return fs.readFileSync(path.join(runs, run ?? '', 'preview.md'), 'utf8');
};

/** Today's UTC date. */
export const today = (): string => new Date().toISOString().slice(0, 10);

/** Register the per-test temp state, block, Slack answers and fetch. */
export function useJobFixture(): void {
  beforeEach(() => {
    mocks.stateDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'channel-meta-job-'),
    );
    mocks.slackRoot = path.join(mocks.stateDir, 'slack-archive');
    fs.mkdirSync(mocks.slackRoot);
    mocks.openclaw = { commands: { ownerAllowFrom: ['slack:U0OWNER'] } };
    mocks.block = {
      serverKey: 'scripts',
      timezone: 'UTC',
      outputDir: reportsDir(),
    };
    mocks.channels = {};
    mocks.clientOptions = [];
    mocks.call.mockReset();
    mocks.post.mockReset();
    mocks.call.mockImplementation((method) =>
      Promise.resolve(
        method === 'auth.test'
          ? { team: 'Acme' }
          : {
              channels: [{ id: 'C1', name: 'general' }],
              response_metadata: {},
            },
      ),
    );
    mocks.dispatchWithSlack.mockReset();
    mocks.dispatchWithSlack.mockResolvedValue({
      task: '',
      posts: [],
      posted: 0,
    });
    mocks.postMessage.mockClear();
    mocks.openDm.mockClear();
    for (const method of ['log', 'error', 'warn'] as const)
      vi.spyOn(console, method).mockImplementation(() => undefined);
    mocks.fetch.mockReset();
    mocks.fetch.mockImplementation(serverFetch);
    vi.stubGlobal('fetch', mocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(mocks.stateDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });
}
