import { describe, expect, it } from 'vitest';

import {
  extractEmailAddress,
  parseAddressList,
  parseFirstAddress,
  splitAddressList,
} from './address.js';

describe('splitAddressList', () => {
  it('splits on top-level commas', () => {
    expect(splitAddressList('a@example.com, b@example.com')).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
  });

  it('does not split on commas inside a quoted display name', () => {
    expect(
      splitAddressList('"Doe, John" <john@example.com>, b@example.com'),
    ).toEqual(['"Doe, John" <john@example.com>', 'b@example.com']);
  });

  it('does not split on commas inside angle brackets', () => {
    // Pathological but shouldn't crash or split mid-bracket.
    expect(splitAddressList('<a@example.com>, <b@example.com>')).toEqual([
      '<a@example.com>',
      '<b@example.com>',
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(splitAddressList('')).toEqual([]);
  });

  it('trims and drops empty segments', () => {
    expect(splitAddressList('a@example.com, , b@example.com')).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
  });
});

describe('extractEmailAddress', () => {
  it('never takes an address from inside a quoted display name', () => {
    expect(
      extractEmailAddress('"Alias <jane@example.com>" <eve@example.com>'),
    ).toBe('eve@example.com');
    expect(
      extractEmailAddress('"Jane \\" <jane@example.com>" <eve@example.com>'),
    ).toBe('eve@example.com');
  });

  it('rejects a segment with more than one angle address as ambiguous', () => {
    expect(
      extractEmailAddress('Jane <jane@example.com> <eve@example.com>'),
    ).toBeNull();
    expect(extractEmailAddress('Jane <jane@example.com')).toBeNull();
  });

  it('extracts from Name <email> form', () => {
    expect(extractEmailAddress('Jane Doe <jane@example.com>')).toBe(
      'jane@example.com',
    );
  });

  it('extracts a bare email', () => {
    expect(extractEmailAddress('jane@example.com')).toBe('jane@example.com');
  });

  it('lowercases the result', () => {
    expect(extractEmailAddress('Jane@Example.COM')).toBe('jane@example.com');
  });

  it('strips quotes from a bare quoted segment', () => {
    expect(extractEmailAddress('"jane@example.com"')).toBe('jane@example.com');
  });

  it('returns null for an unparseable segment', () => {
    expect(extractEmailAddress('not an email')).toBeNull();
    expect(extractEmailAddress('')).toBeNull();
  });
});

describe('parseAddressList', () => {
  it('parses every address, dropping unparseable segments', () => {
    expect(
      parseAddressList(
        '"Doe, John" <john@example.com>, garbage, jane@example.com',
      ),
    ).toEqual(['john@example.com', 'jane@example.com']);
  });

  it('returns empty array for empty header value', () => {
    expect(parseAddressList('')).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(parseAddressList('Jane@Example.COM')).toEqual(['jane@example.com']);
  });
});

describe('parseFirstAddress', () => {
  it('parses a display name and email', () => {
    expect(parseFirstAddress('Jane Doe <jane@example.com>')).toEqual({
      name: 'Jane Doe',
      email: 'jane@example.com',
    });
  });

  it('parses a bare address with no display name', () => {
    expect(parseFirstAddress('jane@example.com')).toEqual({
      name: '',
      email: 'jane@example.com',
    });
  });

  it('takes only the first address in a multi-address header', () => {
    expect(parseFirstAddress('jane@example.com, john@example.com')).toEqual({
      name: '',
      email: 'jane@example.com',
    });
  });

  it('strips quotes from the display name', () => {
    expect(parseFirstAddress('"Doe, Jane" <jane@example.com>')).toEqual({
      name: 'Doe, Jane',
      email: 'jane@example.com',
    });
  });

  it('returns null for an empty or unparseable header', () => {
    expect(parseFirstAddress('')).toBeNull();
    expect(parseFirstAddress('not an email')).toBeNull();
  });
});
