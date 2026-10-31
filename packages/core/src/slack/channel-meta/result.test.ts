/**
 * Tests for the worker's result contract: shape errors fail, each value
 * is checked on its own (length, lines, mentions, missing), and
 * unrequested values are ignored.
 */

import { describe, expect, it } from 'vitest';

import { checkResult, valueProblem, WorkerResultError } from './result.js';

const CAPS = { description: 20, topic: 10 };

describe('valueProblem', () => {
  it.each([
    ['Fine text', undefined],
    ['', 'empty'],
    ['two\nlines', 'more than one line'],
    ['x'.repeat(21), '21 characters, over the 20 cap'],
    ['😀'.repeat(20), undefined],
    ['ping <!here>', 'contains a Slack mention'],
    ['ask <@U123>', 'contains a Slack mention'],
    ['see <#C123>', 'contains a Slack mention'],
    ['a < b', undefined],
  ])('%s -> %s', (text, problem) => {
    expect(valueProblem(text, 20)).toBe(problem);
  });
});

describe('checkResult', () => {
  const c1 = { id: 'C1', fields: ['description', 'topic'] as const };
  const requested = [c1, { id: 'C2', fields: ['topic'] as const }];

  it('accepts good values and rejects the rest per field', () => {
    const out = checkResult(
      JSON.stringify({
        channels: {
          C1: { description: '  About C1  ', topic: 'far too long topic' },
          C2: { description: 'not requested' },
          C9: { topic: 'not asked' },
        },
      }),
      requested,
      CAPS,
    );
    expect(out.accepted).toEqual([
      { request: c1, field: 'description', text: 'About C1' },
    ]);
    expect(out.accepted[0]?.request).toBe(c1);
    expect(out.rejected).toEqual([
      { id: 'C1', field: 'topic', reason: '18 characters, over the 10 cap' },
      { id: 'C2', field: 'topic', reason: 'not written' },
    ]);
  });

  it.each([
    [
      'Now alpha',
      "the worker's result is not valid JSON",
      `The worker's result is not JSON: Unexpected token 'N', "Now alpha" is not valid JSON`,
    ],
    [
      '[]',
      "the worker's result does not match the contract (1 issue)",
      "The worker's result does not match the contract: : Invalid input: expected object, received array",
    ],
    [
      '{"channels":{"C1":{"topic":5},"C2":"Now alpha"}}',
      "the worker's result does not match the contract (2 issues)",
      "The worker's result does not match the contract: channels.C1.topic: Invalid input: expected string, received number; channels.C2: Invalid input: expected object, received string",
    ],
  ])(
    'fails on %s with a fixed summary and the full detail',
    (text, summary, detail) => {
      let thrown: unknown;
      try {
        checkResult(text, requested, CAPS);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(WorkerResultError);
      expect(thrown).toMatchObject({
        name: 'WorkerResultError',
        summary,
        message: detail,
      });
    },
  );
});
