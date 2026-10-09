/**
 * Tests for notion-inbox-processor pure helpers.
 */

import { describe, expect, it } from 'vitest';

import { chunkText, cleanTitle, sha1Prefix } from './notion-inbox-processor.js';

describe('cleanTitle', () => {
  it('returns empty string for null/undefined', () => {
    expect(cleanTitle(null)).toBe('');
    expect(cleanTitle(undefined)).toBe('');
  });

  it('strips @mention suffix', () => {
    expect(cleanTitle('Weekly Standup @jason')).toBe('Weekly Standup');
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

describe('chunkText', () => {
  it('returns single chunk for short text', () => {
    expect(chunkText('hello', 100)).toEqual(['hello']);
  });

  it('splits long text into chunks', () => {
    const text = 'a'.repeat(300);
    const chunks = chunkText(text, 100);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.length === 100)).toBe(true);
  });

  it('handles empty string', () => {
    expect(chunkText('')).toEqual([]);
  });

  it('uses default max of 1200', () => {
    const text = 'x'.repeat(2500);
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(1200);
    expect(chunks[1]).toHaveLength(1200);
    expect(chunks[2]).toHaveLength(100);
  });
});
