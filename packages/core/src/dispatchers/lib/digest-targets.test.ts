import { beforeEach, describe, expect, it, vi } from 'vitest';

const refs = vi.hoisted(() => {
  const value: Record<string, string> = {};
  return { value };
});

vi.mock('../../config/pipeline-accessors.js', () => ({
  tryGetRef: (key: string) => refs.value[key] ?? '',
}));

import { digestTargets } from './digest-targets.js';

describe('digestTargets', () => {
  beforeEach(() => {
    refs.value = {};
  });

  it('allows no targets when neither ref is set', () => {
    expect(digestTargets()).toEqual([]);
  });

  it('allows the digest channel, then the operator DM', () => {
    refs.value = { 'slack.digestChannel': 'C1', 'slack.operatorDm': 'D1' };
    expect(digestTargets().map((t) => t.target)).toEqual(['C1', 'D1']);
  });

  it('allows only the refs that are set', () => {
    refs.value = { 'slack.operatorDm': 'D1' };
    expect(digestTargets()).toEqual([
      { target: 'D1', purpose: 'completion summary (operator DM)' },
    ]);
  });
});
