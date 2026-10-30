/**
 * Tests for notion-inbox-processor pure helpers.
 */

import { describe, expect, it } from 'vitest';

import { cleanTitle, sha1Prefix } from './notion-inbox-processor.js';

describe('cleanTitle', () => {
  it('returns empty string for null/undefined', () => {
    expect(cleanTitle(null)).toBe('');
    expect(cleanTitle(undefined)).toBe('');
  });

  it('strips @mention suffix', () => {
    expect(cleanTitle('Weekly Standup @jane')).toBe('Weekly Standup');
  });

  it('normalizes whitespace', () => {
    expect(cleanTitle('  hello   world  ')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(cleanTitle('')).toBe('');
  });

  it('preserves normal titles', () => {
    expect(cleanTitle('Product Review Q1')).toBe('Product Review Q1');
  });
});

describe('sha1Prefix', () => {
  it('returns a hex string of the specified length', () => {
    const result = sha1Prefix('test-page-id');
    expect(result).toHaveLength(12);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it('returns consistent results for same input', () => {
    expect(sha1Prefix('abc')).toBe(sha1Prefix('abc'));
  });

  it('returns different results for different inputs', () => {
    expect(sha1Prefix('abc')).not.toBe(sha1Prefix('def'));
  });

  it('respects custom length', () => {
    expect(sha1Prefix('test', 8)).toHaveLength(8);
  });
});
