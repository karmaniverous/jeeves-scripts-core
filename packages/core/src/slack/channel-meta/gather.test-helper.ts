/**
 * @module slack/channel-meta/gather.test-helper
 *
 * Shared setup for the channel-meta gather tests: an in-memory
 * archive, an assignment post, a seeded meta, and gather deps whose
 * history fallback reads nothing unless overridden. Test-only.
 */

import { vi } from 'vitest';

import {
  memoryArchiveFs,
  messageJson,
  settingsFrom,
} from './fakes.test-helper.js';
import type { GatherDeps } from './gather.js';
import type { ChannelMessage } from './messages.js';

/** A day in seconds. */
export const DAY = 86_400;
/** The run's instant in seconds. */
export const NOW_S = 1_800_000_000;
/** Windows-host settings with a `j` root and a 7-day window. */
export const GATHER_SETTINGS = settingsFrom({
  pathRoots: { j: 'J:/' },
  activityDays: 7,
});

/** A post assigning `p` as the home directory. */
export const assignText = (p: string): string =>
  `create \`${p}\` and seed meta. This is the home directory.`;

/** A seeded meta's text. */
export const META = JSON.stringify({
  _generatedAt: '2026-10-01T00:00:00Z',
  _content: 'About',
});

/** Archive files for `messages` in `dir`. */
export const archived = (
  dir: string,
  messages: ChannelMessage[],
): Record<string, string> =>
  Object.fromEntries(
    messages.map((m) => [`${dir}/${m.ts}.json`, messageJson(m)]),
  );

/** Gather deps over `files`; C1 is archived, history reads nothing. */
export const gatherDeps = (
  files: Record<string, string>,
  over: Partial<GatherDeps> = {},
): GatherDeps => ({
  io: memoryArchiveFs(files),
  archiveDirs: new Map([['C1', '/arch/general (C1)']]),
  homeDirOf: () => undefined,
  history: vi.fn(() => Promise.resolve({ messages: [], truncated: false })),
  ...over,
});
