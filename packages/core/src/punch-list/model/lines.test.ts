import { describe, expect, it } from 'vitest';

import { entryTitle, getMarker, removeMarker, setMarker } from './lines.js';

describe('markers', () => {
  it('sets, reads and removes', () => {
    const t = setMarker('**A** — b · added 2026-10-01', 'done', '2026-10-18');
    expect(t).toBe('**A** — b · added 2026-10-01 · done 2026-10-18');
    expect(getMarker(t, 'done')).toBe('2026-10-18');
    expect(getMarker(t, 'added')).toBe('2026-10-01');
    expect(removeMarker(t, 'done')).toBe('**A** — b · added 2026-10-01');
    expect(setMarker(t, 'done', '2026-10-19')).toBe(
      '**A** — b · added 2026-10-01 · done 2026-10-19',
    );
  });
});

describe('entryTitle', () => {
  it('is the bold part, else the text before the dash, lower-cased', () => {
    expect(entryTitle('**Dropbox Support** \u2014 files')).toBe(
      'dropbox support',
    );
    expect(entryTitle('Plain Title \u2014 details')).toBe('plain title');
    expect(entryTitle('  Just Text  ')).toBe('just text');
  });
});
