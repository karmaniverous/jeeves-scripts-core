/**
 * Tests for the read-only survey: excluded channels are left out, each
 * channel is gathered from its own saved state (so an already-swept
 * assignment is not proposed again), and the next state keeps channels
 * not surveyed this run.
 */

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { BlockInput } from './fakes.test-helper.js';
import {
  channel,
  human,
  memoryArchiveFs,
  messageJson,
  settingsFrom,
  ts,
  workspace,
} from './fakes.test-helper.js';
import { emptyState, type JobState } from './state.js';
import { surveyChannels, type SurveyDeps } from './survey.js';

const NOW_S = 1_800_000_000;
const ASSIGNED_S = NOW_S - 3600;

const deps: SurveyDeps = {
  archiveRoots: () => ['/arch'],
  io: memoryArchiveFs({
    [`/arch/one (C1)/${ts(NOW_S - 60)}.json`]: messageJson(
      human(NOW_S - 60, 'working on it'),
    ),
    [`/arch/two (C2)/${ts(ASSIGNED_S)}.json`]: messageJson(
      human(ASSIGNED_S, 'seed meta for `j/home/c2`, the home directory'),
    ),
    '/home/c1/.meta/meta.json': '{"_content":"About"}',
    '/home/c2/x': '',
  }),
  homeDirOf: (id) => (id === 'C1' ? '/home/c1' : undefined),
  history: () => Promise.resolve({ messages: [], truncated: false }),
};

const workspaces = [
  workspace('default', [
    channel('C1', { name: 'one' }),
    channel('C2', { name: 'two' }),
  ]),
];

const survey = (block: Partial<BlockInput>, state: JobState) =>
  surveyChannels(
    workspaces,
    settingsFrom({ pathRoots: { j: '/' }, ...block }, path.posix),
    state,
    new Date(NOW_S * 1000),
    deps,
  );

describe('surveyChannels', () => {
  it('gathers every member channel, wants text where a meta is seeded, and records sweep positions', async () => {
    const s = await survey({}, emptyState());
    expect(s.facts.map((f) => [f.channel.id, f.finding?.kind])).toEqual([
      ['C1', undefined],
      ['C2', 'proposal'],
    ]);
    expect(s.wanted.map((w) => w.id)).toEqual(['C1']);
    expect(s.next.channels.C2?.assignment?.path).toBe('/home/c2');
  });

  it('leaves excluded channels out', async () => {
    const s = await survey({ excludeChannels: ['C1'] }, emptyState());
    expect(s.facts.map((f) => f.channel.id)).toEqual(['C2']);
    expect(s.wanted).toEqual([]);
    expect(s.next.channels).not.toHaveProperty('C1');
  });

  it("gathers each channel from its own state and keeps others' state", async () => {
    const swept = ts(NOW_S - 1);
    const state: JobState = {
      ...emptyState(),
      channels: { C2: { sweptTs: swept }, C9: { sweptTs: '1.000001' } },
    };
    const s = await survey({}, state);
    expect(s.facts.find((f) => f.channel.id === 'C2')?.finding).toBeUndefined();
    expect(s.next.channels.C2?.sweptTs).toBe(swept);
    expect(s.next.channels.C9).toEqual({ sweptTs: '1.000001' });
    expect(state.channels).not.toHaveProperty('C1');
  });
});
