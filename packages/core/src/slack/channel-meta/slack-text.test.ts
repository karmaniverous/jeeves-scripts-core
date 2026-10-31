/**
 * Tests for Slack text escaping and decoding.
 */

import { describe, expect, it } from 'vitest';

import { decodeSlack, escapeSlack } from './slack-text.js';

describe('slack text', () => {
  it('escapes control characters, ampersand first', () => {
    expect(escapeSlack('<!here> & <@U1>')).toBe(
      '&lt;!here&gt; &amp; &lt;@U1&gt;',
    );
  });

  it('decodes them, ampersand last', () => {
    expect(decodeSlack('&lt;b&gt; &amp;lt;')).toBe('<b> &lt;');
  });

  it('round-trips', () => {
    const text = 'a < b && c > &amp;';
    expect(decodeSlack(escapeSlack(text))).toBe(text);
  });
});
