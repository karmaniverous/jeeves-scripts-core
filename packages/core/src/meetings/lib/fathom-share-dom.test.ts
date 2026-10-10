import { describe, expect, it } from 'vitest';

import type { DomSnapshot } from './fathom-share-dom.js';
import {
  extractSectionsFromSnapshot,
  normalizeDomSnapshot,
} from './fathom-share-dom.js';

// ── extractSectionsFromSnapshot ─────────────────────────────────────

describe('normalizeDomSnapshot', () => {
  it('returns empty arrays for malformed snapshots', () => {
    expect(normalizeDomSnapshot({})).toEqual({ buttons: [], headings: [] });
    expect(normalizeDomSnapshot(null)).toEqual({ buttons: [], headings: [] });
  });

  it('preserves array-backed snapshot fields', () => {
    const snapshot = {
      buttons: [{ text: 'Copy Summary', ancestorTexts: ['abc'] }],
      headings: [{ text: 'Transcript', followingTexts: ['hello'] }],
    };

    expect(normalizeDomSnapshot(snapshot)).toEqual(snapshot);
  });
});

// ── extractSectionsFromSnapshot ─────────────────────────────────────

describe('extractSectionsFromSnapshot', () => {
  it('extracts transcript from button ancestor text', () => {
    const snapshot: DomSnapshot = {
      buttons: [
        {
          text: 'Copy Transcript',
          ancestorTexts: [
            [
              'Copy Transcript',
              'Speaker 1: Hello everyone, welcome to the meeting.',
              'Speaker 2: Thanks for having us. Let us get started on the agenda.',
              'Speaker 1: First item is the deployment schedule for next week.',
            ].join('\n'),
          ],
        },
      ],
      headings: [],
    };

    const result = extractSectionsFromSnapshot(snapshot);

    expect(result.transcript).toContain('Speaker 1');
    expect(result.transcript).toContain('Speaker 2');
    expect(result.transcript).not.toContain('Copy Transcript');
  });

  it('extracts transcript from heading following-sibling text', () => {
    const snapshot: DomSnapshot = {
      buttons: [],
      headings: [
        {
          text: 'Transcript',
          followingTexts: [
            'Speaker A: First line of the transcript.',
            'Speaker B: Second line of the transcript.',
          ],
        },
      ],
    };

    const result = extractSectionsFromSnapshot(snapshot);

    expect(result.transcript).toBe(
      'Speaker A: First line of the transcript.\nSpeaker B: Second line of the transcript.',
    );
  });

  it('returns empty transcript when only summary is present', () => {
    const snapshot: DomSnapshot = {
      buttons: [
        {
          text: 'Copy Summary',
          ancestorTexts: [
            [
              'Copy Summary',
              'The team discussed the roadmap and agreed on three priority items.',
              'Budget allocation was reviewed and approved for the next quarter cycle.',
            ].join('\n'),
          ],
        },
      ],
      headings: [],
    };

    const result = extractSectionsFromSnapshot(snapshot);

    expect(result.summary).toContain('roadmap');
    expect(result.transcript).toBe('');
  });

  it('returns empty strings when snapshot has no relevant elements', () => {
    const snapshot: DomSnapshot = { buttons: [], headings: [] };
    const result = extractSectionsFromSnapshot(snapshot);
    expect(result).toEqual({ summary: '', transcript: '' });
  });

  it('prefers button strategy over heading strategy', () => {
    const snapshot: DomSnapshot = {
      buttons: [
        {
          text: 'Copy Summary',
          ancestorTexts: [
            [
              'Copy Summary',
              'Button-derived content from the meeting notes about project planning.',
              'Additional details that bring the total length over one hundred characters for the check.',
            ].join('\n'),
          ],
        },
      ],
      headings: [
        {
          text: 'Summary',
          followingTexts: ['Heading-derived content'],
        },
      ],
    };

    const result = extractSectionsFromSnapshot(snapshot);

    expect(result.summary).toContain('Button-derived');
    expect(result.summary).not.toContain('Heading-derived');
  });

  it('extracts both summary and transcript from a mixed snapshot', () => {
    const snapshot: DomSnapshot = {
      buttons: [
        {
          text: 'Copy Summary',
          ancestorTexts: [
            [
              'Copy Summary',
              'The meeting covered three main topics: roadmap, budget, and hiring plan.',
              'All stakeholders agreed on the proposed timeline for Q4 deliverables.',
            ].join('\n'),
          ],
        },
      ],
      headings: [
        {
          text: 'Transcript',
          followingTexts: [
            'Speaker 1: Let us begin with the roadmap discussion.',
            'Speaker 2: Sure, I have the slides ready.',
          ],
        },
      ],
    };

    const result = extractSectionsFromSnapshot(snapshot);

    expect(result.summary).toContain('roadmap');
    expect(result.transcript).toContain('Speaker 1');
  });

  it('skips ancestor text blocks shorter than 100 characters', () => {
    const snapshot: DomSnapshot = {
      buttons: [
        {
          text: 'Copy Transcript',
          ancestorTexts: ['Short text', 'Also short'],
        },
      ],
      headings: [
        {
          text: 'Transcript',
          followingTexts: ['Fallback transcript from heading.'],
        },
      ],
    };

    const result = extractSectionsFromSnapshot(snapshot);

    expect(result.transcript).toBe('Fallback transcript from heading.');
  });
});
