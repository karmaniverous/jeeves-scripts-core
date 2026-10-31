/**
 * Tests for applying the worker's result: wanted fields per channel,
 * rejected values reported, accepted values that differ from the current
 * one set with the channel's own workspace (whoever wrote the current
 * value), values equal to it not written, failures (refused, or a
 * re-read showing another value) reported and left unrecorded, and the
 * state recording the meta and message marks each value came from.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  type ApplyFn,
  applyResult,
  UNVERIFIED,
  wantedOf,
} from './apply-result.js';
import { channel, workspace } from './fakes.test-helper.js';
import type { ChannelFacts } from './gather.js';
import { emptyState } from './state.js';

const facts = (id: string, over: Partial<ChannelFacts> = {}): ChannelFacts => ({
  channel: channel(id),
  homeDir: `/h/${id}`,
  homeDirExists: true,
  meta: { file: 'm', generatedAt: '2026-10-01T00:00:00Z' },
  recent: [],
  lastHumanTs: '100.000000',
  plans: {
    description: { action: 'generate', reason: 'empty' },
    topic: { action: 'generate', reason: 'stale' },
  },
  next: { sweptTs: '100.000000' },
  ...over,
});

const NOW = new Date('2026-10-22T07:00:00.000Z');
const CAPS = { description: 50, topic: 20 };

describe('wantedOf', () => {
  it('asks for the generated fields with their reasons, or nothing', () => {
    const ws = workspace('default', []);
    expect(wantedOf(facts('C1'), ws)).toEqual([
      {
        id: 'C1',
        fields: ['description', 'topic'],
        facts: facts('C1'),
        ws,
        reasons: { description: 'empty', topic: 'stale' },
      },
    ]);
    const none = facts('C2', {
      plans: {
        description: { action: 'skip', reason: 'fresh' },
        topic: { action: 'skip', reason: 'quiet' },
      },
    });
    expect(wantedOf(none, ws)).toEqual([]);
  });
});

describe('applyResult', () => {
  const wsA = workspace('default', []);
  const wsB = workspace('vc', []);
  const batch = [
    ...wantedOf(facts('C1'), wsA),
    ...wantedOf(facts('C2', { meta: { file: 'm' } }), wsB),
  ];

  it('sets accepted values with each channel\u2019s workspace and records them', async () => {
    const apply = vi.fn<ApplyFn>((_ws, id, field, text) =>
      Promise.resolve(
        id === 'C2' && field === 'topic'
          ? { ok: false, code: 'missing_scope' }
          : {
              ok: true,
              value: field === 'topic' ? 'Changed by Slack' : text,
              verified: field !== 'topic',
            },
      ),
    );
    const earlierTopic = {
      generatedAt: '2026-09-01T00:00:00Z',
      checkedAt: 'x',
    };
    const next = {
      ...emptyState(),
      channels: { C1: { sweptTs: '100.000000', topic: earlierTopic } },
    };
    const outcomes = await applyResult(
      JSON.stringify({
        channels: {
          C1: { description: 'About C1', topic: 'Now: C1' },
          C2: { description: 'x'.repeat(51), topic: 'Now: C2' },
        },
      }),
      batch,
      CAPS,
      next,
      NOW,
      apply,
    );
    expect(apply.mock.calls).toEqual([
      [wsA, 'C1', 'description', 'About C1'],
      [wsA, 'C1', 'topic', 'Now: C1'],
      [wsB, 'C2', 'topic', 'Now: C2'],
    ]);
    expect(outcomes).toEqual([
      {
        id: 'C2',
        field: 'description',
        status: 'rejected',
        detail: '51 characters, over the 50 cap',
      },
      { id: 'C1', field: 'description', status: 'updated', text: 'About C1' },
      {
        id: 'C1',
        field: 'topic',
        status: 'failed',
        detail: UNVERIFIED,
        text: 'Now: C1',
      },
      {
        id: 'C2',
        field: 'topic',
        status: 'failed',
        detail: 'missing_scope',
        text: 'Now: C2',
      },
    ]);
    expect(next.channels.C1).toEqual({
      sweptTs: '100.000000',
      description: {
        generatedAt: '2026-10-01T00:00:00Z',
        lastMessageTs: undefined,
        checkedAt: NOW.toISOString(),
      },
      topic: earlierTopic,
    });
    expect(next.channels).not.toHaveProperty('C2');
  });

  it('overwrites a hand-written value and skips one already current', async () => {
    const handWritten = facts('C3', {
      channel: channel('C3', {
        purpose: 'Written by a person',
        topic: 'Now:  same &amp; old',
      }),
    });
    const apply = vi.fn<ApplyFn>((_ws, _id, _field, text) =>
      Promise.resolve({ ok: true, value: text, verified: true }),
    );
    const next = emptyState();
    const outcomes = await applyResult(
      JSON.stringify({
        channels: {
          C3: { description: 'From the meta', topic: 'Now: same & old' },
        },
      }),
      wantedOf(handWritten, wsA),
      CAPS,
      next,
      NOW,
      apply,
    );
    expect(apply.mock.calls).toEqual([
      [wsA, 'C3', 'description', 'From the meta'],
    ]);
    expect(outcomes).toEqual([
      {
        id: 'C3',
        field: 'description',
        status: 'updated',
        text: 'From the meta',
      },
      {
        id: 'C3',
        field: 'topic',
        status: 'unchanged',
        text: 'Now: same & old',
      },
    ]);
    expect(next.channels.C3?.topic).toEqual({
      generatedAt: '2026-10-01T00:00:00Z',
      lastMessageTs: '100.000000',
      checkedAt: NOW.toISOString(),
    });
    expect(next.channels.C3?.description?.checkedAt).toBe(NOW.toISOString());
  });

  it('records a value generated from an unsynthesized meta without a mark', async () => {
    const next = emptyState();
    await applyResult(
      JSON.stringify({
        channels: { C2: { description: 'About', topic: 'Now' } },
      }),
      batch.slice(1),
      CAPS,
      next,
      NOW,
      (_ws, _id, _field, text) =>
        Promise.resolve({ ok: true, value: text, verified: true }),
    );
    expect(next.channels.C2?.description).toEqual({
      generatedAt: undefined,
      lastMessageTs: undefined,
      checkedAt: NOW.toISOString(),
    });
  });

  it('fails when the worker wrote nothing or broke the contract', async () => {
    const apply = vi.fn<ApplyFn>();
    await expect(
      applyResult(undefined, batch, CAPS, emptyState(), NOW, apply),
    ).rejects.toThrow('the worker wrote no result');
    await expect(
      applyResult('{}', batch, CAPS, emptyState(), NOW, apply),
    ).rejects.toThrow('does not match the contract');
    expect(apply).not.toHaveBeenCalled();
  });
});
