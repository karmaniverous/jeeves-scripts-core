/**
 * @module slack/channel-meta/refresh.test-helper
 *
 * A harness for the channel-meta flow tests: `refreshChannelMeta`
 * deps over an in-memory archive, with every side effect (state saves,
 * report files, posts, logs, sets, dispatches) recorded. Test-only.
 */

import path from 'node:path';

import { vi } from 'vitest';

import type { ApplyFn } from './apply-result.js';
import {
  type BlockInput,
  channel,
  human,
  memoryArchiveFs,
  messageJson,
  settingsFrom,
  ts,
  workspace,
} from './fakes.test-helper.js';
import { findDestination } from './post.js';
import type { RefreshDeps } from './refresh.js';
import { emptyState, type JobState } from './state.js';
import type { Workspace } from './workspaces.js';

/** The run's instant (2027-01-15T08:00Z; 2027-01-14 in Honolulu). */
export const NOW_S = 1_800_000_000;
const META = JSON.stringify({
  _generatedAt: '2026-10-01T00:00:00Z',
  _content: 'About',
});

const files: Record<string, string> = {
  [`/arch/one (C1)/${ts(NOW_S - 3600)}.json`]: messageJson(
    human(NOW_S - 3600, 'working on it'),
  ),
  [`/arch/two (C2)/${ts(NOW_S - 3600)}.json`]: messageJson(
    human(
      NOW_S - 3600,
      'create `j/home/c2` and seed meta. This is the home directory.',
    ),
  ),
  '/home/c1/.meta/meta.json': META,
  '/home/c2/x': '',
};

/** The report link the fake server gives. */
export const LINK = '<https://jeeves.example/r|report>';
/** The report file: `outputDir` joined natively (it is a host path). */
export const REPORT_FILE = path.join('/out', '2027-01-14.md');

/** A run with every side effect recorded. */
export interface Harness {
  deps: RefreshDeps;
  saved: JobState[];
  posts: { text: string; target: string; account: string }[];
  delivered: { outputDir: string; date: string; text: string }[];
  logs: string[];
  apply: ReturnType<typeof vi.fn<ApplyFn>>;
  dispatch: ReturnType<typeof vi.fn<RefreshDeps['dispatch']>>;
}

/**
 * A run harness: two channels in one workspace (C1 with a seeded home
 * directory, C2 assigned one in Slack), POSIX paths, Honolulu dates.
 *
 * @param runsRoot - A temp directory for run directories.
 * @param over - Overrides.
 * @returns The deps and what they recorded.
 */
export const harness = (
  runsRoot: string,
  over: {
    block?: Partial<BlockInput>;
    state?: JobState;
    result?: (resultFile: string) => string | undefined;
    channels?: ReturnType<typeof channel>[];
    link?: () => Promise<string>;
    /** Archive and home files instead of the two-channel default. */
    files?: Record<string, string>;
    homeDirOf?: (id: string) => string | undefined;
    /** The run's instant in seconds. */
    nowS?: number;
    /** Workspaces instead of one default workspace with the channels. */
    workspaces?: () => Workspace[];
    /** The history fallback (default: reads nothing). */
    history?: RefreshDeps['history'];
  } = {},
): Harness => {
  const saved: JobState[] = [];
  const posts: Harness['posts'] = [];
  const delivered: Harness['delivered'] = [];
  const logs: string[] = [];
  const io = memoryArchiveFs(over.files ?? files);
  const apply = vi.fn<ApplyFn>((_ws, _id, _field, text) =>
    Promise.resolve({ ok: true, value: text, verified: true }),
  );
  const dispatch = vi.fn<RefreshDeps['dispatch']>(() =>
    Promise.resolve(undefined),
  );
  const deps: RefreshDeps = {
    settings: () =>
      settingsFrom(
        {
          pathRoots: { j: '/' },
          timezone: 'Pacific/Honolulu',
          ...over.block,
        },
        path.posix,
      ),
    workspaces: () =>
      Promise.resolve(
        over.workspaces?.() ?? [
          workspace(
            'default',
            over.channels ?? [
              channel('C1', { name: 'one' }),
              channel('C2', { name: 'two' }),
            ],
            {
              team: 'Acme',
            },
          ),
        ],
      ),
    archiveRoots: () => ['/arch'],
    io: {
      ...io,
      readText: (file) =>
        file.endsWith('result.json') ? over.result?.(file) : io.readText(file),
    },
    homeDirOf:
      over.homeDirOf ?? ((id) => (id === 'C1' ? '/home/c1' : undefined)),
    history:
      over.history ??
      (() => Promise.resolve({ messages: [], truncated: false })),
    loadState: () => over.state ?? emptyState(),
    saveState: (s) => {
      saved.push(structuredClone(s));
    },
    runsRoot,
    now: () => new Date((over.nowS ?? NOW_S) * 1000),
    dispatch,
    apply,
    reportLink: over.link ?? (() => Promise.resolve(LINK)),
    deliver: (outputDir, date, text) => {
      delivered.push({ outputDir, date, text });
      return `${outputDir}/${date}.md`;
    },
    destination: findDestination,
    post: (text, destination) => {
      posts.push({
        text,
        target: destination.channel,
        account: destination.ws.account,
      });
      return Promise.resolve(destination.ws.account);
    },
    log: (line) => {
      logs.push(line);
    },
  };
  return { deps, saved, posts, delivered, logs, apply, dispatch };
};

/** A valid worker result for C1. */
export const GOOD = JSON.stringify({
  channels: { C1: { description: 'About one', topic: 'Now: one' } },
});

export const LIVE = { live: true, printTask: false };
export const DRY = { live: false, printTask: false };
/** Both update switches off. */
export const REPORT_ONLY = {
  updateDescriptions: false,
  updateTopics: false,
};
