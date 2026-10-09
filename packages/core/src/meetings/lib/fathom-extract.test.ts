import { describe, expect, it } from 'vitest';

import {
  decodeHtmlEntities,
  extractHiddenDivInnerHtml,
  htmlToText,
  isFathomShareManifest,
  parseFathomArgs,
} from './fathom-extract.js';

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

describe('parseFathomArgs', () => {
  it('parses --dry-run flag', () => {
    const result = parseFathomArgs(['--dry-run']);
    expect(result.dryRun).toBe(true);
    expect(result.max).toBeNull();
  });

  it('parses --max=N', () => {
    const result = parseFathomArgs(['--max=3']);
    expect(result.max).toBe(3);
  });

  it('returns defaults for no args', () => {
    const result = parseFathomArgs([]);
    expect(result.dryRun).toBe(false);
    expect(result.max).toBeNull();
  });
});
