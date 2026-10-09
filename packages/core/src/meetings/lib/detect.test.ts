import { describe, expect, it } from 'vitest';

import {
  detectFathomFromBodies,
  detectFathomUrl,
  detectMeetingSource,
  isMeetingish,
  normalizeFathomUrl,
} from './detect.js';

describe('detectFathomUrl', () => {
  it('detects share links', () => {
    const result = detectFathomUrl(
      'Check out https://fathom.video/share/abc123 for the recording',
    );
    expect(result).toEqual({
      kind: 'share',
      url: 'https://fathom.video/share/abc123',
    });
  });

  it('detects calls links', () => {
    const result = detectFathomUrl(
      'See https://fathom.video/calls/def456 for details',
    );
    expect(result).toEqual({
      kind: 'call',
      url: 'https://fathom.video/calls/def456',
    });
  });

  it('prefers share over calls when both present', () => {
    const text =
      'https://fathom.video/calls/aaa https://fathom.video/share/bbb';
    const result = detectFathomUrl(text);
    expect(result?.kind).toBe('share');
    expect(result?.url).toContain('/share/');
  });

  it('returns null for no Fathom URL', () => {
    expect(detectFathomUrl('Hello world, no fathom links')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(detectFathomUrl('')).toBeNull();
  });

  it('handles www prefix', () => {
    const result = detectFathomUrl('https://www.fathom.video/share/xyz789');
    expect(result?.kind).toBe('share');
  });
});

describe('normalizeFathomUrl', () => {
  it('strips UTM parameters', () => {
    const url =
      'https://fathom.video/share/abc?utm_source=email&utm_medium=recap';
    expect(normalizeFathomUrl(url)).toBe('https://fathom.video/share/abc');
  });

  it('decodes &amp; HTML entities before stripping UTM params', () => {
    const url =
      'https://fathom.video/share/abc?tab=summary&amp;utm_campaign=postmeetingsummary&amp;utm_content=view_recording_link&amp;utm_medium=email';
    expect(normalizeFathomUrl(url)).toBe(
      'https://fathom.video/share/abc?tab=summary',
    );
  });

  it('strips fbclid and gclid', () => {
    const url = 'https://fathom.video/share/abc?fbclid=123&gclid=456';
    expect(normalizeFathomUrl(url)).toBe('https://fathom.video/share/abc');
  });

  it('preserves non-tracking params', () => {
    const url = 'https://fathom.video/share/abc?t=120';
    expect(normalizeFathomUrl(url)).toBe(
      'https://fathom.video/share/abc?t=120',
    );
  });

  it('handles URLs with no params', () => {
    const url = 'https://fathom.video/share/abc123';
    expect(normalizeFathomUrl(url)).toBe('https://fathom.video/share/abc123');
  });

  it('returns original string for invalid URLs', () => {
    expect(normalizeFathomUrl('not a url')).toBe('not a url');
  });
});

describe('detectFathomFromBodies', () => {
  it('finds share link in text body', () => {
    const result = detectFathomFromBodies(
      'Link: https://fathom.video/share/abc',
      '',
    );
    expect(result?.kind).toBe('share');
  });

  it('finds share link in HTML body when text has none', () => {
    const result = detectFathomFromBodies(
      'No links here',
      '<a href="https://fathom.video/share/abc">View</a>',
    );
    expect(result?.kind).toBe('share');
  });

  it('share in text takes precedence over calls in HTML', () => {
    const result = detectFathomFromBodies(
      'https://fathom.video/share/abc',
      'https://fathom.video/calls/def',
    );
    expect(result?.kind).toBe('share');
    expect(result?.url).toContain('/share/');
  });

  it('falls back to calls link', () => {
    const result = detectFathomFromBodies('https://fathom.video/calls/def', '');
    expect(result?.kind).toBe('call');
  });

  it('share in HTML outranks calls in text', () => {
    const result = detectFathomFromBodies(
      'https://fathom.video/calls/def',
      '<a href="https://fathom.video/share/abc">View</a>',
    );
    expect(result?.kind).toBe('share');
    expect(result?.url).toContain('/share/');
  });

  it('returns null when no Fathom URLs found', () => {
    expect(detectFathomFromBodies('hello', 'world')).toBeNull();
  });
});

describe('isMeetingish + Fathom URL fallback (gap 1)', () => {
  it('isMeetingish misses email with only Fathom URL in body', () => {
    // An email whose subject/from/snippet don't match any heuristic
    expect(isMeetingish('Weekly Sync', 'bob@example.com', 'Hi team')).toBe(
      false,
    );
  });

  it('detectFathomFromBodies catches Fathom URL that isMeetingish misses', () => {
    // The body contains a Fathom link even though metadata doesn't trigger isMeetingish
    const bodyText = 'Recording: https://fathom.video/share/abc123';
    const result = detectFathomFromBodies(bodyText, '');
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('share');
  });

  it('combined check: isMeetingish || fathomUrl covers the gap', () => {
    const subject = 'Weekly Sync';
    const from = 'bob@example.com';
    const snippet = 'Hi team';
    const bodyText = 'Recording: https://fathom.video/share/abc123';

    // isMeetingish alone would miss it
    const heuristic = isMeetingish(subject, from, snippet);
    // Body-based detection catches it
    const fathom = detectFathomFromBodies(bodyText, '');

    expect(heuristic || fathom !== null).toBe(true);
  });
});

describe('detectMeetingSource with URL detection', () => {
  it('detects fathom from share URL in body', () => {
    expect(
      detectMeetingSource(
        'someone@example.com',
        'Weekly Sync',
        'Check https://fathom.video/share/abc',
        '',
      ),
    ).toBe('fathom');
  });

  it('URL-based fathom outranks from-header heuristics', () => {
    expect(
      detectMeetingSource(
        'gemini-notes@google.com',
        'Meeting Summary',
        'https://fathom.video/share/abc',
        '',
      ),
    ).toBe('fathom');
  });

  it('falls back to from-header when no URL', () => {
    expect(
      detectMeetingSource(
        'gemini-notes@google.com',
        'Meeting Summary',
        'No fathom links',
        '',
      ),
    ).toBe('gemini');
  });

  it('backwards compatible without body args', () => {
    // Without body args, URL-based Fathom detection is skipped;
    // from-based 'fathom' match returns 'not-meeting' per spec.
    expect(detectMeetingSource('noreply@fathom.video', 'Your recap')).toBe(
      'not-meeting',
    );
  });
});
