/**
 * Tests for transcript rendering: byte-identical to the prototype for the
 * same response, plus the slug, clock and counts.
 */

import { describe, expect, it } from 'vitest';

import {
  PROTOTYPE_KEPT_NAME,
  PROTOTYPE_MARKDOWN,
  PROTOTYPE_RESPONSE,
  PROTOTYPE_RETRIEVED,
} from './render-markdown.fixtures.js';
import {
  clock,
  renderTranscript,
  slug,
  transcriptResponseSchema,
} from './render-markdown.js';

const response = transcriptResponseSchema.parse(PROTOTYPE_RESPONSE);

describe('renderTranscript', () => {
  it("renders the prototype's Markdown byte for byte", () => {
    expect(
      renderTranscript(response, 'dQw4w9WgXcQ', PROTOTYPE_RETRIEVED).markdown,
    ).toBe(PROTOTYPE_MARKDOWN);
  });

  it("reports the prototype's metadata, counts and kept name", () => {
    const { markdown: _markdown, ...rest } = renderTranscript(
      response,
      'dQw4w9WgXcQ',
      PROTOTYPE_RETRIEVED,
    );
    expect(rest).toEqual({
      videoId: 'dQw4w9WgXcQ',
      title: 'Café Design: It’s "Simple" (Part 1)',
      author: "Ana Example's Channel",
      length: '1:00:12',
      segments: 5,
      words: 21,
      keptName: PROTOTYPE_KEPT_NAME,
    });
  });

  it('falls back to the requested id and empty fields when the response has none', () => {
    const r = renderTranscript(
      { transcript: [{ text: 'hi there', start: 5 }], metadata: {} },
      'abcdefghijk',
      '2026-01-02',
    );
    expect(r.markdown).toBe(
      [
        '---',
        'title: ""',
        'author: ""',
        'author_url: ',
        'source: https://www.youtube.com/watch?v=abcdefghijk',
        'video_id: abcdefghijk',
        'length: "0:05"',
        'language: ',
        'type: video-transcript',
        'retrieved: 2026-01-02',
        'retrieved_via: TranscriptAPI (auto-generated captions)',
        '---',
        '',
        '# abcdefghijk',
        '',
        '**Source:** [https://www.youtube.com/watch?v=abcdefghijk](https://www.youtube.com/watch?v=abcdefghijk)  ',
        '**Author:** []() · 0:05',
        '',
        '> Auto-generated YouTube captions; expect transcription errors.',
        '',
        '## Transcript',
        '',
        '[0:05] hi there',
        '',
      ].join('\n'),
    );
    expect(r).toMatchObject({
      title: undefined,
      author: undefined,
      words: 2,
      keptName: 'untitled-untitled.md',
    });
  });

  it('reads numeric strings and treats missing start and text as zero and empty', () => {
    const r = renderTranscript(
      {
        transcript: [{}, { text: 7, start: '65', duration: '10' }],
        metadata: { title: 'T' },
      },
      'abcdefghijk',
      '2026-01-02',
    );
    expect(r.markdown.endsWith('## Transcript\n\n[0:00]   \n[1:05] 7\n')).toBe(
      true,
    );
    expect(r.length).toBe('1:15');
    expect(r.words).toBe(1);
  });
});

describe('transcriptResponseSchema', () => {
  it.each([
    ['no transcript', { metadata: {} }],
    ['an empty transcript', { transcript: [], metadata: {} }],
    ['no metadata', { transcript: [{ text: 'x' }] }],
  ])('rejects a response with %s', (_, data) => {
    expect(transcriptResponseSchema.safeParse(data).success).toBe(false);
  });
});

describe('slug', () => {
  it.each([
    ['Café Design: It’s "Simple"', 'cafe-design-its-simple'],
    ["  --Ana's  Channel--  ", 'anas-channel'],
    [undefined, 'untitled'],
    [null, 'untitled'],
    ['!!!', 'untitled'],
    [42, '42'],
  ])('slugs %j as %s', (input, expected) => {
    expect(slug(input)).toBe(expected);
  });

  it('cuts at 60 characters without a trailing hyphen', () => {
    const long = `${'a'.repeat(59)} bcd`;
    expect(slug(long)).toBe('a'.repeat(59));
    expect(slug('b'.repeat(70))).toBe('b'.repeat(60));
  });
});

describe('clock', () => {
  it.each([
    [0, '0:00'],
    [5.9, '0:05'],
    [65, '1:05'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
    [36000, '10:00:00'],
  ])('formats %d seconds as %s', (seconds, expected) => {
    expect(clock(seconds)).toBe(expected);
  });
});
