import { describe, expect, it } from 'vitest';

import { stripEmbeddedImages } from './strip-images.js';

const B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('stripEmbeddedImages', () => {
  it('leaves text without data-URI images untouched', () => {
    const text = '# Title\n\n![logo](https://example.com/logo.png)\n\nBody.';
    expect(stripEmbeddedImages(text)).toBe(text);
  });

  it('replaces Markdown data-URI images, keeping alt text', () => {
    expect(stripEmbeddedImages(`a ![](data:image/png;base64,${B64}) b`)).toBe(
      'a [image] b',
    );
    expect(
      stripEmbeddedImages(`![Org chart](data:image/jpeg;base64,${B64})`),
    ).toBe('[image: Org chart]');
  });

  it('handles back-to-back images and images inside HTML wrappers', () => {
    const text = `<div style="text-align: center">![](data:image/png;base64,${B64})![](data:image/png;base64,${B64})</div>`;
    expect(stripEmbeddedImages(text)).toBe(
      '<div style="text-align: center">[image][image]</div>',
    );
  });

  it('handles base64 payloads that wrap across lines and titles', () => {
    const wrapped = `${B64.slice(0, 20)}\n${B64.slice(20)}`;
    expect(
      stripEmbeddedImages(`![x](data:image/png;base64,${wrapped} "t")`),
    ).toBe('[image: x]');
  });

  it('replaces HTML <img> tags with data-URI sources', () => {
    expect(
      stripEmbeddedImages(
        `<p><img alt="Chart 1" src="data:image/svg+xml;base64,${B64}" width="10"></p>`,
      ),
    ).toBe('<p>[image: Chart 1]</p>');
    expect(
      stripEmbeddedImages(`<img src='data:image/gif;base64,${B64}'/>`),
    ).toBe('[image]');
  });

  it('replaces bare data URIs such as reference definitions', () => {
    expect(
      stripEmbeddedImages(`[img1]: data:image/png;base64,${B64}\nText`),
    ).toBe('[img1]: [image]\nText');
  });

  it('keeps surrounding prose intact', () => {
    const text = `Intro.\n\n![](data:image/png;base64,${B64})\n\nOutro.`;
    expect(stripEmbeddedImages(text)).toBe('Intro.\n\n[image]\n\nOutro.');
  });
});
