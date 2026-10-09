import fs from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { extractSectionsFromSnapshot } from './fathom-share-dom.js';
import {
  extractAfterMarker,
  resolveChromePath,
  setFathomShareTab,
  stripLeadingTranscriptChrome,
} from './fathom-share-fetch.js';

// ── extractSectionsFromSnapshot ──────────────────────────────────────────

describe('extractSectionsFromSnapshot', () => {
  it('extracts summary via "Copy Summary" button with substantial ancestor text', () => {
    // Multi-line ancestor text simulating a real Fathom section.
    // The "Copy Summary" line should be stripped; content lines kept.
    const contentLines = [
      'Copy Summary',
      'The team discussed the Q4 roadmap and agreed on three priority items.',
      'Action items were assigned to each team lead for follow-up by Friday.',
      'Budget allocation was reviewed and approved for the next quarter cycle.',
    ];
    const buttons = [
      {
        text: 'Copy Summary',
        ancestorTexts: ['short', contentLines.join('\n')],
      },
    ];
    const headings: { text: string; followingTexts: string[] }[] = [];

    const result = extractSectionsFromSnapshot({ buttons, headings });

    expect(result.summary).not.toContain('Copy Summary');
    expect(result.summary).toContain('Q4 roadmap');
    expect(result.summary).toContain('Action items');
  });

  it('extracts transcript via "Copy Transcript" button', () => {
    const contentLines = [
      'Copy Transcript',
      'Speaker 1: Hello everyone, welcome to the meeting.',
      'Speaker 2: Thanks for having us. Let us get started on the agenda.',
      'Speaker 1: First item is the deployment schedule for next week.',
    ];
    const buttons = [
      {
        text: 'Copy Transcript',
        ancestorTexts: [contentLines.join('\n')],
      },
    ];
    const headings: { text: string; followingTexts: string[] }[] = [];

    const result = extractSectionsFromSnapshot({ buttons, headings });

    expect(result.transcript).toContain('Speaker 1');
    expect(result.transcript).not.toContain('Copy Transcript');
  });

  it('falls back to heading-based extraction when no buttons match', () => {
    const buttons: { text: string; ancestorTexts: string[] }[] = [];
    const headings = [
      {
        text: 'Summary',
        followingTexts: ['Key points from the meeting.'],
      },
      {
        text: 'Transcript',
        followingTexts: ['Speaker A: First line.', 'Speaker B: Second line.'],
      },
    ];

    const result = extractSectionsFromSnapshot({ buttons, headings });

    expect(result.summary).toBe('Key points from the meeting.');
    expect(result.transcript).toBe(
      'Speaker A: First line.\nSpeaker B: Second line.',
    );
  });

  it('returns empty strings when nothing matches', () => {
    const result = extractSectionsFromSnapshot({ buttons: [], headings: [] });
    expect(result).toEqual({ summary: '', transcript: '' });
  });

  it('prefers button strategy over heading strategy', () => {
    const contentLines = [
      'Copy Summary',
      'Button-derived content from the meeting notes about project planning.',
      'Additional details that bring the total length over one hundred characters for the check.',
    ];
    const buttons = [
      {
        text: 'Copy Summary',
        ancestorTexts: [contentLines.join('\n')],
      },
    ];
    const headings = [
      {
        text: 'Summary',
        followingTexts: ['Heading-derived content'],
      },
    ];

    const result = extractSectionsFromSnapshot({ buttons, headings });

    expect(result.summary).toContain('Button-derived');
    expect(result.summary).not.toContain('Heading-derived');
  });
});

// ── extractAfterMarker ─────────────────────────────────────────────

describe('extractAfterMarker', () => {
  it('extracts lines after an exact marker line', () => {
    const body = [
      'Get your own free AI Notetaker',
      'Copy Summary',
      'Meeting Purpose',
      'Introduce Jason and Jonathan',
    ].join('\n');

    expect(extractAfterMarker(body, 'Copy Summary')).toBe(
      'Meeting Purpose\nIntroduce Jason and Jonathan',
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
    const original = process.env['PUPPETEER_EXECUTABLE_PATH'];
    // Use a path we know exists — the node binary itself
    process.env['PUPPETEER_EXECUTABLE_PATH'] = process.execPath;
    try {
      expect(resolveChromePath()).toBe(process.execPath);
    } finally {
      if (original === undefined) {
        delete process.env['PUPPETEER_EXECUTABLE_PATH'];
      } else {
        process.env['PUPPETEER_EXECUTABLE_PATH'] = original;
      }
    }
  });

  it('uses CHROME_PATH when PUPPETEER_EXECUTABLE_PATH is not set', () => {
    const origPuppeteer = process.env['PUPPETEER_EXECUTABLE_PATH'];
    const origChrome = process.env['CHROME_PATH'];

    delete process.env['PUPPETEER_EXECUTABLE_PATH'];
    process.env['CHROME_PATH'] = process.execPath;

    try {
      expect(resolveChromePath()).toBe(process.execPath);
    } finally {
      if (origPuppeteer === undefined) {
        delete process.env['PUPPETEER_EXECUTABLE_PATH'];
      } else {
        process.env['PUPPETEER_EXECUTABLE_PATH'] = origPuppeteer;
      }
      if (origChrome === undefined) {
        delete process.env['CHROME_PATH'];
      } else {
        process.env['CHROME_PATH'] = origChrome;
      }
    }
  });

  it('throws when env path does not exist on disk', () => {
    const original = process.env['PUPPETEER_EXECUTABLE_PATH'];
    process.env['PUPPETEER_EXECUTABLE_PATH'] = '/nonexistent/chrome/executable';
    try {
      expect(() => resolveChromePath()).toThrow(
        /Chrome executable not found at path from environment/,
      );
    } finally {
      if (original === undefined) {
        delete process.env['PUPPETEER_EXECUTABLE_PATH'];
      } else {
        process.env['PUPPETEER_EXECUTABLE_PATH'] = original;
      }
    }
  });

  it('throws with helpful message when no Chrome found and no env set', () => {
    const origPuppeteer = process.env['PUPPETEER_EXECUTABLE_PATH'];
    const origChrome = process.env['CHROME_PATH'];

    delete process.env['PUPPETEER_EXECUTABLE_PATH'];
    delete process.env['CHROME_PATH'];

    // Mock fs.existsSync to always return false (no candidates found)
    const existsSync = vi.spyOn(fs, 'existsSync');
    existsSync.mockReturnValue(false);

    try {
      expect(() => resolveChromePath()).toThrow(/PUPPETEER_EXECUTABLE_PATH/);
    } finally {
      existsSync.mockRestore();
      if (origPuppeteer === undefined) {
        delete process.env['PUPPETEER_EXECUTABLE_PATH'];
      } else {
        process.env['PUPPETEER_EXECUTABLE_PATH'] = origPuppeteer;
      }
      if (origChrome === undefined) {
        delete process.env['CHROME_PATH'];
      } else {
        process.env['CHROME_PATH'] = origChrome;
      }
    }
  });
});
