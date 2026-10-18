import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isFathomShareManifest, runFathomExtract } from './fathom-extract.js';
import {
  decodeHtmlEntities,
  extractHiddenDivInnerHtml,
  htmlToText,
} from './fathom-html.js';

describe('decodeHtmlEntities', () => {
  it('decodes named entities', () => {
    expect(decodeHtmlEntities('&amp; &lt; &gt; &quot; &#39;')).toBe(
      '& < > " \'',
    );
  });

  it('decodes &nbsp;', () => {
    expect(decodeHtmlEntities('hello&nbsp;world')).toBe('hello world');
  });

  it('decodes numeric decimal entities', () => {
    expect(decodeHtmlEntities('&#65;&#66;&#67;')).toBe('ABC');
  });

  it('decodes numeric hex entities', () => {
    expect(decodeHtmlEntities('&#x41;&#x42;&#x43;')).toBe('ABC');
  });

  it('preserves invalid entities', () => {
    expect(decodeHtmlEntities('&#xFFFFFFFF;')).toBe('&#xFFFFFFFF;');
  });

  it('handles empty string', () => {
    expect(decodeHtmlEntities('')).toBe('');
  });
});

describe('isFathomShareManifest', () => {
  it('returns true for explicit share meetings', () => {
    expect(
      isFathomShareManifest({
        fathomKind: 'share',
        fathomUrl: 'https://fathom.video/share/abc',
      }),
    ).toBe(true);
  });

  it('returns true for share URLs even without fathomKind', () => {
    expect(
      isFathomShareManifest({
        fathomUrl: 'https://fathom.video/share/abc',
      }),
    ).toBe(true);
  });

  it('returns false for call meetings', () => {
    expect(
      isFathomShareManifest({
        fathomKind: 'call',
        fathomUrl: 'https://fathom.video/calls/abc',
      }),
    ).toBe(false);
  });
});

describe('extractHiddenDivInnerHtml', () => {
  it('extracts content from standard Fathom hidden div', () => {
    const html =
      '<html><body>' +
      '<div style="display:none;">Meeting Purpose<p>Hello</p><p>World</p></div>' +
      '</body></html>';
    expect(extractHiddenDivInnerHtml(html)).toBe(
      'Meeting Purpose<p>Hello</p><p>World</p>',
    );
  });

  it('extracts from generic display:none div when marker is missing', () => {
    const html =
      '<html><body>' +
      '<div style="display:none;"><p>Content here</p></div>' +
      '</body></html>';
    expect(extractHiddenDivInnerHtml(html)).toBe('<p>Content here</p>');
  });

  it('handles nested divs', () => {
    const html =
      '<div style="display:none;">Meeting Purpose<div><p>Inner</p></div></div>';
    expect(extractHiddenDivInnerHtml(html)).toBe(
      'Meeting Purpose<div><p>Inner</p></div>',
    );
  });

  it('returns null when no hidden div exists', () => {
    const html = '<html><body><p>No hidden div</p></body></html>';
    expect(extractHiddenDivInnerHtml(html)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractHiddenDivInnerHtml('')).toBeNull();
  });

  it('handles display:none with extra whitespace', () => {
    const html = '<div style=" display : none "><p>Content</p></div>';
    expect(extractHiddenDivInnerHtml(html)).toBe('<p>Content</p>');
  });
});

describe('htmlToText', () => {
  it('converts br tags to newlines', () => {
    expect(htmlToText('Hello<br>World')).toBe('Hello\nWorld\n');
    expect(htmlToText('Hello<br/>World')).toBe('Hello\nWorld\n');
    expect(htmlToText('Hello<br />World')).toBe('Hello\nWorld\n');
  });

  it('converts closing block tags to newlines', () => {
    expect(htmlToText('<p>Para 1</p><p>Para 2</p>')).toBe('Para 1\nPara 2\n');
  });

  it('converts list items to dashes', () => {
    expect(htmlToText('<li>Item 1</li><li>Item 2</li>')).toBe(
      '- Item 1\n- Item 2\n',
    );
  });

  it('strips remaining HTML tags', () => {
    expect(htmlToText('<b>Bold</b> <i>Italic</i>')).toBe('Bold Italic\n');
  });

  it('decodes HTML entities', () => {
    expect(htmlToText('&amp; &lt;tag&gt;')).toBe('& <tag>\n');
  });

  it('normalizes whitespace', () => {
    expect(htmlToText('Hello    World\n\n\n\nEnd')).toBe(
      'Hello World\n\nEnd\n',
    );
  });

  it('handles empty string', () => {
    expect(htmlToText('')).toBe('\n');
  });
});

describe('runFathomExtract', () => {
  const manifest = (id: string, extra: Record<string, unknown> = {}) => ({
    meetingId: id,
    source: 'fathom',
    date: '2026-03-02',
    sortTimestampMs: 1,
    sortSource: 'email',
    ...extra,
  });
  let dir: string;
  const pkg = (
    id: string,
    files: Record<string, string>,
    meta: Record<string, unknown> = {},
  ) => {
    const mp = path.join(dir, id);
    fs.mkdirSync(mp, { recursive: true });
    fs.writeFileSync(
      path.join(mp, 'meeting.json'),
      JSON.stringify(manifest(id, meta)),
    );
    for (const [f, body] of Object.entries(files))
      fs.writeFileSync(path.join(mp, f), body);
    return mp;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fathom-extract-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = undefined;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('extracts the hidden transcript and records it in the manifest', () => {
    const mp = pkg('m1', {
      'fathom-a.html':
        '<div style="display:none;">Meeting Purpose<p>Hi</p></div>',
    });
    runFathomExtract({}, [dir, path.join(dir, 'absent')], () => 'NOW');
    expect(fs.readFileSync(path.join(mp, 'transcript.txt'), 'utf8')).toBe(
      'Meeting PurposeHi\n',
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(mp, 'meeting.json'), 'utf8')),
    ).toMatchObject({
      hasTranscript: true,
      transcriptExtractedAt: 'NOW',
      artifacts: ['transcript.txt'],
    });
  });

  it('skips share meetings and transcribed ones, honours --max and --dry-run', () => {
    pkg('share', { 'fathom-a.html': 'x' }, { fathomKind: 'share' });
    pkg('done', { 'fathom-a.html': 'x', 'transcript.txt': 't' });
    pkg('m2', { 'fathom-a.html': 'x' });
    pkg('m3', { 'fathom-b.html': 'x' });
    runFathomExtract({ dryRun: true, max: 1 }, [dir]);
    expect(console.log).toHaveBeenCalledWith(
      '[fathom-extract] Found 1 meetings needing extraction',
    );
    expect(fs.existsSync(path.join(dir, 'm2', 'transcript.txt'))).toBe(false);
  });

  it('fails a meeting without a hidden div and sets exit code 1', () => {
    pkg('bad', { 'fathom-a.html': '<p>nothing hidden</p>' });
    runFathomExtract({}, [dir]);
    expect(console.error).toHaveBeenCalledWith(
      '[fathom-extract] FAIL bad: Could not locate hidden transcript div',
    );
    expect(process.exitCode).toBe(1);
  });
});
