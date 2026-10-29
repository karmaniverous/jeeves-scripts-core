import fs from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { resolveChromePath } from './chrome-path.js';
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

// ── resolveChromePath ───────────────────────────────────────────────

describe('resolveChromePath', () => {
  it('uses PUPPETEER_EXECUTABLE_PATH when set and file exists', () => {
    const original = process.env.PUPPETEER_EXECUTABLE_PATH;
    // Use a path we know exists — the node binary itself
    process.env.PUPPETEER_EXECUTABLE_PATH = process.execPath;
    try {
      expect(resolveChromePath()).toBe(process.execPath);
    } finally {
      if (original === undefined) {
        delete process.env.PUPPETEER_EXECUTABLE_PATH;
      } else {
        process.env.PUPPETEER_EXECUTABLE_PATH = original;
      }
    }
  });

  it('uses CHROME_PATH when PUPPETEER_EXECUTABLE_PATH is not set', () => {
    const origPuppeteer = process.env.PUPPETEER_EXECUTABLE_PATH;
    const origChrome = process.env.CHROME_PATH;

    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    process.env.CHROME_PATH = process.execPath;

    try {
      expect(resolveChromePath()).toBe(process.execPath);
    } finally {
      if (origPuppeteer === undefined) {
        delete process.env.PUPPETEER_EXECUTABLE_PATH;
      } else {
        process.env.PUPPETEER_EXECUTABLE_PATH = origPuppeteer;
      }
      if (origChrome === undefined) {
        delete process.env.CHROME_PATH;
      } else {
        process.env.CHROME_PATH = origChrome;
      }
    }
  });

  it('throws when env path does not exist on disk', () => {
    const original = process.env.PUPPETEER_EXECUTABLE_PATH;
    process.env.PUPPETEER_EXECUTABLE_PATH = '/nonexistent/chrome/executable';
    try {
      expect(() => resolveChromePath()).toThrow(
        /Chrome executable not found at path from environment/,
      );
    } finally {
      if (original === undefined) {
        delete process.env.PUPPETEER_EXECUTABLE_PATH;
      } else {
        process.env.PUPPETEER_EXECUTABLE_PATH = original;
      }
    }
  });

  it('throws with helpful message when no Chrome found and no env set', () => {
    const origPuppeteer = process.env.PUPPETEER_EXECUTABLE_PATH;
    const origChrome = process.env.CHROME_PATH;

    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.CHROME_PATH;

    // Mock fs.existsSync to always return false (no candidates found)
    const existsSync = vi.spyOn(fs, 'existsSync');
    existsSync.mockReturnValue(false);

    try {
      expect(() => resolveChromePath()).toThrow(/PUPPETEER_EXECUTABLE_PATH/);
    } finally {
      existsSync.mockRestore();
      if (origPuppeteer === undefined) {
        delete process.env.PUPPETEER_EXECUTABLE_PATH;
      } else {
        process.env.PUPPETEER_EXECUTABLE_PATH = origPuppeteer;
      }
      if (origChrome === undefined) {
        delete process.env.CHROME_PATH;
      } else {
        process.env.CHROME_PATH = origChrome;
      }
    }
  });
});
