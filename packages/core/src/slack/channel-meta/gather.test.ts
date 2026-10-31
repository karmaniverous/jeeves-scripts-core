/**
 * Tests for gathering one channel: archive source, incremental sweep
 * from the saved position, coverage facts, recent activity, write scopes
 * and the next state. The history fallback: gather-history.test.ts.
 */

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  bot,
  channel,
  human,
  settingsFrom,
  ts,
  workspace,
} from './fakes.test-helper.js';
import { gatherChannel } from './gather.js';
import {
  archived,
  assignText,
  DAY,
  GATHER_SETTINGS as settings,
  gatherDeps as deps,
  META,
  NOW_S,
} from './gather.test-helper.js';

describe('gatherChannel', () => {
  it('sweeps the whole archive on a first run and plans from coverage', async () => {
    const files = {
      ...archived('/arch/general (C1)', [
        human(NOW_S - 30 * DAY, assignText('j/home/c1')),
        human(NOW_S - DAY, 'recent'),
        bot(NOW_S - DAY / 2, 'bot recent'),
      ]),
      'J:/home/c1/.meta/meta.json': META,
    };
    const facts = await gatherChannel(
      channel('C1'),
      workspace('default', []),
      settings,
      {},
      NOW_S * 1000,
      deps(files, { homeDirOf: () => 'J:/home/c1' }),
    );
    expect(facts.finding).toBeUndefined();
    expect(facts.homeDirExists).toBe(true);
    expect(facts.meta?.generatedAt).toBe('2026-10-01T00:00:00Z');
    expect(facts.recent.map((m) => m.text)).toEqual(['recent', 'bot recent']);
    expect(facts.lastHumanTs).toBe(ts(NOW_S - DAY));
    expect(facts.plans).toEqual({
      description: { action: 'generate', reason: 'empty' },
      topic: { action: 'generate', reason: 'empty' },
    });
    expect(facts.next).toEqual({
      sweptTs: ts(NOW_S - DAY / 2),
      assignment: { ts: ts(NOW_S - 30 * DAY), path: 'J:/home/c1' },
    });
    expect(facts.readError).toBeUndefined();
  });

  it('proposes an unconfigured assignment and sweeps only unswept messages', async () => {
    const files = {
      ...archived('/arch/general (C1)', [
        human(NOW_S - 20 * DAY, assignText('j/stale')),
        human(NOW_S - 10 * DAY, assignText('j/new')),
      ]),
      'J:/new/x': '',
      'J:/stale/x': '',
    };
    const state = {
      sweptTs: ts(NOW_S - 15 * DAY),
      assignment: { ts: ts(NOW_S - 40 * DAY), path: 'J:/old' },
    };
    const facts = await gatherChannel(
      channel('C1'),
      workspace('default', []),
      settings,
      state,
      NOW_S * 1000,
      deps(files),
    );
    expect(facts.finding).toEqual({ kind: 'proposal', path: 'J:/new' });
    expect(facts.homeDir).toBeUndefined();
    expect(facts.plans.description).toEqual({
      action: 'skip',
      reason: 'no-home-dir',
    });
    expect(facts.plans.topic).toEqual({
      action: 'skip',
      reason: 'no-home-dir',
    });
    expect(facts.recent).toEqual([]);
  });

  it('reads the window even when the sweep position is newer, without re-sweeping it', async () => {
    const files = {
      ...archived('/arch/general (C1)', [
        human(NOW_S - 3 * DAY, assignText('j/swept')),
        human(NOW_S - 2 * DAY, 'old news'),
      ]),
      'J:/swept/x': '',
    };
    const state = { sweptTs: ts(NOW_S - DAY) };
    const facts = await gatherChannel(
      channel('C1'),
      workspace('default', []),
      settings,
      state,
      NOW_S * 1000,
      deps(files),
    );
    expect(facts.lastHumanTs).toBe(ts(NOW_S - 2 * DAY));
    expect(facts.next).toEqual({ sweptTs: ts(NOW_S - DAY) });
    expect(facts.finding).toBeUndefined();
  });

  it('maps written roots to POSIX paths on a POSIX host', async () => {
    const posix = settingsFrom(
      { pathRoots: { j: '/opt/jeeves/' } },
      path.posix,
    );
    const files = {
      ...archived('/arch/general (C1)', [
        human(NOW_S - 2 * DAY, assignText('J:\\windows\\only')),
        human(NOW_S - DAY, assignText('j/domains/c1')),
      ]),
      '/opt/jeeves/domains/c1/x': '',
    };
    const facts = await gatherChannel(
      channel('C1'),
      workspace('default', []),
      posix,
      {},
      NOW_S * 1000,
      deps(files),
    );
    expect(facts.finding).toEqual({
      kind: 'proposal',
      path: '/opt/jeeves/domains/c1',
    });
  });

  it('flags a missing home directory and a missing write scope, and regenerates a hand-written value', async () => {
    const files = {
      ...archived('/arch/general (C1)', [human(NOW_S - DAY, 'hi')]),
      'J:/home/c1/.meta/meta.json': META,
    };
    const ws = workspace('default', [], { scopes: ['groups:write.topic'] });
    const facts = await gatherChannel(
      channel('C1', { purpose: 'By hand' }),
      ws,
      settings,
      {},
      NOW_S * 1000,
      deps(files, { homeDirOf: () => 'J:/home/c1' }),
    );
    expect(facts.plans.description).toEqual({
      action: 'skip',
      reason: 'missing-scope',
    });
    expect(facts.plans.topic).toEqual({
      action: 'skip',
      reason: 'missing-scope',
    });
    const unknownScopes = await gatherChannel(
      channel('C1', { purpose: 'By hand' }),
      workspace('default', []),
      settings,
      {},
      NOW_S * 1000,
      deps(files, { homeDirOf: () => 'J:/home/c1' }),
    );
    expect(unknownScopes.plans.description).toEqual({
      action: 'generate',
      reason: 'new',
    });
    const missing = await gatherChannel(
      channel('C1'),
      ws,
      settings,
      {},
      NOW_S * 1000,
      deps({}, { homeDirOf: () => 'J:/gone' }),
    );
    expect(missing.homeDirExists).toBe(false);
    expect(missing.meta).toBeUndefined();
    expect(missing.plans.description).toEqual({
      action: 'skip',
      reason: 'home-dir-missing',
    });
  });

  it('honours private-channel scopes and the update switches', async () => {
    const files = {
      ...archived('/arch/general (C1)', [human(NOW_S - DAY, 'hi')]),
      'J:/home/c1/.meta/meta.json': META,
    };
    const off = settingsFrom({
      updateDescriptions: false,
      updateTopics: false,
    });
    const ws = workspace('default', [], { scopes: ['groups:write.topic'] });
    const priv = await gatherChannel(
      channel('C1', { isPrivate: true }),
      ws,
      settings,
      {},
      NOW_S * 1000,
      deps(files, { homeDirOf: () => 'J:/home/c1' }),
    );
    expect(priv.plans.topic).toEqual({ action: 'generate', reason: 'empty' });
    const disabled = await gatherChannel(
      channel('C1'),
      ws,
      off,
      {},
      NOW_S * 1000,
      deps(files, { homeDirOf: () => 'J:/home/c1' }),
    );
    expect(disabled.plans).toEqual({
      description: { action: 'skip', reason: 'disabled' },
      topic: { action: 'skip', reason: 'disabled' },
    });
  });
});
