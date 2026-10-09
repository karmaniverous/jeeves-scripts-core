import { describe, expect, it } from 'vitest';

import { extractDocId, parseDocFetchArgs } from './doc-fetch.js';

describe('extractDocId', () => {
  it('extracts doc ID from standard Google Docs URL', () => {
    expect(
      extractDocId(
        'https://docs.google.com/document/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/edit',
      ),
    ).toBe('1aBcDeFgHiJkLmNoPqRsTuVwXyZ');
  });

  it('extracts doc ID with hyphens and underscores', () => {
    expect(
      extractDocId(
        'https://docs.google.com/document/d/abc-def_123/edit#heading=h.xyz',
      ),
    ).toBe('abc-def_123');
  });

  it('returns null for URL without doc ID pattern', () => {
    expect(extractDocId('https://example.com/foo')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractDocId('')).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(extractDocId(null)).toBeNull();
    expect(extractDocId(undefined)).toBeNull();
  });
});

describe('parseDocFetchArgs', () => {
  it('parses --dry-run flag', () => {
    const result = parseDocFetchArgs(['--dry-run']);
    expect(result.dryRun).toBe(true);
    expect(result.max).toBeNull();
  });

  it('parses --max=N', () => {
    const result = parseDocFetchArgs(['--max=5']);
    expect(result.max).toBe(5);
    expect(result.dryRun).toBe(false);
  });

  it('parses both flags together', () => {
    const result = parseDocFetchArgs(['--dry-run', '--max=10']);
    expect(result.dryRun).toBe(true);
    expect(result.max).toBe(10);
  });

  it('returns defaults for no args', () => {
    const result = parseDocFetchArgs([]);
    expect(result.dryRun).toBe(false);
    expect(result.max).toBeNull();
  });

  it('ignores non-matching args', () => {
    const result = parseDocFetchArgs(['--other=foo', 'positional']);
    expect(result.dryRun).toBe(false);
    expect(result.max).toBeNull();
  });
});
