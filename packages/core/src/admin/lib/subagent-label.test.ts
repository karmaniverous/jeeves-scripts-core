import { describe, expect, it } from 'vitest';

import { detectMetaPhase, detectSubagentLabel } from './subagent-label.js';

describe('detectSubagentLabel', () => {
  it.each([
    ['taskName="Fix the drain"', 'subagent:task:Fix the drain'],
    ['taskName: drain-fix, other', 'subagent:task:drain-fix'],
    ["label='weekly report'", 'subagent:label:weekly report'],
    ['reply in <#C0123456789|general>', 'subagent:for:#general'],
    ['reply in <#C0123456789|#ops>', 'subagent:for:#ops'],
    ['reply in <#C0123456789>', 'subagent:for:C0123456789'],
    ['open D:\\repos\\acme\\widget\\src', 'subagent:repo:acme/widget'],
    ['clone to /repos/acme/gadget/', 'subagent:repo:acme/gadget'],
    ['# Migrate the archive\nbody', 'subagent:task:Migrate the archive'],
    ['# Instructions\nsee drain/spec.md', 'subagent:spec:drain'],
    ['# This is in the system prompt\nnothing else', null],
    ['plain text', null],
  ])('%j -> %s', (text, key) => {
    expect(detectSubagentLabel(text)?.key ?? null).toBe(key);
  });

  it('truncates long names to 60 characters', () => {
    const long = 'x'.repeat(80);
    expect(detectSubagentLabel(`taskName=${long}`)?.name).toBe(
      `Subagent: task ${'x'.repeat(60)}`,
    );
  });
});

describe('detectMetaPhase', () => {
  it.each([
    [
      '# jeeves-meta \u00b7 ARCHITECT \u00b7 j:/domains/x',
      'meta-architect',
      'Meta Architect',
    ],
    [
      '# jeeves-meta \u2022 builder \u2022 path',
      'meta-builder',
      'Meta Builder',
    ],
    ['session meta-critic run', 'meta-critic', 'Meta Critic'],
  ])('%j', (text, key, name) => {
    expect(detectMetaPhase(text)).toEqual({ key, name });
  });

  it('finds no phase in other text', () => {
    expect(detectMetaPhase('# Something else')).toBeNull();
  });
});
