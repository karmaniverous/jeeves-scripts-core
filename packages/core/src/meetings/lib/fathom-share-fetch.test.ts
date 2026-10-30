import { describe, expect, it } from 'vitest';

import {
  extractAfterMarker,
  setFathomShareTab,
  stripLeadingTranscriptChrome,
} from './fathom-share-fetch.js';

// ── extractAfterMarker ─────────────────────────────────────────────

describe('extractAfterMarker', () => {
  it('extracts lines after an exact marker line', () => {
    const body = [
      'Get your own free AI Notetaker',
      'Copy Summary',
      'Meeting Purpose',
      'Introduce Jane and John',
    ].join('\n');

    expect(extractAfterMarker(body, 'Copy Summary')).toBe(
      'Meeting Purpose\nIntroduce Jane and John',
    );
  });

  it('returns empty string when marker is missing', () => {
    expect(extractAfterMarker('hello\nworld', 'Copy Summary')).toBe('');
  });
});

// ── Fathom tab URL / transcript cleanup helpers ────────────────────

describe('setFathomShareTab', () => {
  it('adds the tab query param when missing', () => {
    expect(
      setFathomShareTab('https://fathom.video/share/abc123', 'transcript'),
    ).toBe('https://fathom.video/share/abc123?tab=transcript');
  });

  it('replaces an existing tab query param and preserves other params', () => {
    expect(
      setFathomShareTab(
        'https://fathom.video/share/abc123?foo=bar&tab=summary',
        'transcript',
      ),
    ).toBe('https://fathom.video/share/abc123?foo=bar&tab=transcript');
  });
});

describe('stripLeadingTranscriptChrome', () => {
  it('removes leading Resume Auto-Scroll chrome', () => {
    const text = [
      '',
      'Resume Auto-Scroll',
      'Acme Corp',
      '',
      "There's Rachel.",
    ].join('\n');

    expect(stripLeadingTranscriptChrome(text)).toBe(
      "Acme Corp\n\nThere's Rachel.",
    );
  });

  it('leaves normal transcript text intact', () => {
    const text = 'Speaker 1\nHello there';
    expect(stripLeadingTranscriptChrome(text)).toBe(text);
  });
});
