import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { emailHtmlToText, extractPlainBody } from './email-html.js';

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64url');

const APPLE_MAIL_HTML = fs.readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../email/google-workspace/respond/fixtures/apple-mail-html-only.html',
  ),
  'utf8',
);

describe('emailHtmlToText', () => {
  it('drops head, style, script and comments', () => {
    expect(
      emailHtmlToText(
        '<html><head><title>T</title><style>p{color:red}</style></head><body><!-- x --><script>alert(1)</script><p>Hello</p></body></html>',
      ),
    ).toBe('Hello');
  });

  it('keeps line structure from br and block elements', () => {
    expect(emailHtmlToText('One<br>Two<div>Three</div><p>Four</p>')).toBe(
      'One\nTwo\nThree\n\nFour',
    );
  });

  it('keeps link targets, without repeating a bare URL', () => {
    expect(
      emailHtmlToText(
        '<a href="https://ex.com/a">Ex</a> and <a href="https://ex.com/b">https://ex.com/b</a>',
      ),
    ).toBe('Ex (https://ex.com/a) and https://ex.com/b');
  });

  it('keeps only the label for mailto and cid links', () => {
    expect(emailHtmlToText('<a href="mailto:a@b.com">Ann</a>')).toBe('Ann');
  });

  it('decodes entities, with &amp; last', () => {
    expect(emailHtmlToText('a&nbsp;&lt;b&gt; &amp;lt; &#39;c&#x27;')).toBe(
      "a <b> &lt; 'c'",
    );
  });

  it('returns empty for HTML with no visible content', () => {
    expect(emailHtmlToText('<html><body><div><br></div></body></html>')).toBe(
      '',
    );
  });

  it('renders the real Apple Mail rich-link message', () => {
    const text = emailHtmlToText(APPLE_MAIL_HTML);
    expect(text).toContain('This video shows the setup I described last week');
    expect(text).toContain('https://video.example.com/watch/abc123');
    expect(text).toContain('Reply to the whole group');
    expect(text).toContain('Mark Doe');
    expect(text).not.toMatch(/<|border-radius/);
  });
});

describe('extractPlainBody', () => {
  it('prefers a non-empty text/plain part', () => {
    expect(
      extractPlainBody({
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: b64('plain') } },
          { mimeType: 'text/html', body: { data: b64('<p>html</p>') } },
        ],
      }),
    ).toBe('plain');
  });

  it('falls back to rendered HTML when there is no text/plain part', () => {
    expect(
      extractPlainBody({
        mimeType: 'multipart/alternative',
        parts: [
          {
            mimeType: 'multipart/related',
            parts: [
              { mimeType: 'text/html', body: { data: b64('<p>Hi there</p>') } },
              { mimeType: 'image/png', filename: 'x.png', body: {} },
            ],
          },
        ],
      }),
    ).toBe('Hi there');
  });

  it('falls back to HTML when text/plain is blank', () => {
    expect(
      extractPlainBody({
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: b64('  \n') } },
          { mimeType: 'text/html', body: { data: b64('<b>Bold</b>') } },
        ],
      }),
    ).toBe('Bold');
  });

  it('returns empty for an empty payload', () => {
    expect(extractPlainBody(undefined)).toBe('');
  });
});
