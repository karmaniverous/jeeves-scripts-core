/**
 * Tests for linear-client exported helpers: enrichComment and sleepMs.
 *
 * Does NOT test linearQuery, paginateIssues, paginateComments (network),
 * or loadConfig (filesystem).
 */

import { describe, expect, it } from 'vitest';

import { enrichComment, sleepMs } from './linear-client.js';

describe('enrichComment', () => {
  it('adds _issueIdentifier when issue.identifier is present', () => {
    const raw = {
      id: 'c1',
      body: 'hello',
      issue: { id: 'i1', identifier: 'ENG-42' },
    };
    const result = enrichComment(raw);
    expect(result._issueIdentifier).toBe('ENG-42');
  });

  it('returns shallow copy (does not mutate input)', () => {
    const raw = {
      id: 'c1',
      body: 'hello',
      issue: { id: 'i1', identifier: 'ENG-42' },
    };
    const result = enrichComment(raw);
    expect(result).not.toBe(raw);
    expect(raw).not.toHaveProperty('_issueIdentifier');
  });

  it('does NOT add _issueIdentifier when issue is absent', () => {
    const raw = { id: 'c1', body: 'standalone comment' };
    const result = enrichComment(raw);
    expect(result).not.toHaveProperty('_issueIdentifier');
  });

  it('does NOT add _issueIdentifier when issue has no identifier', () => {
    const raw = {
      id: 'c1',
      body: 'hello',
      issue: { id: 'i1' },
    };
    const result = enrichComment(raw);
    expect(result).not.toHaveProperty('_issueIdentifier');
  });
});

describe('sleepMs', () => {
  it('resolves after approximately the requested delay', async () => {
    const start = performance.now();
    await sleepMs(10);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(5);
  });
});
