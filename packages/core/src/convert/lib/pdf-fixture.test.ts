/**
 * The committed PDF fixtures are the builder's output, byte for byte, so
 * they can always be regenerated (`npx tsx scripts/write-pdf-fixtures.ts`).
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildPdf, pdfFixtures } from './pdf-fixture.test-helper.js';

describe('PDF fixtures', () => {
  it.each(Object.entries(pdfFixtures))(
    '%s matches its builder',
    (name, pages) => {
      const committed = readFileSync(
        new URL(`fixtures/${name}`, import.meta.url),
      );
      expect(committed.equals(buildPdf(pages))).toBe(true);
    },
  );

  it('escapes PDF string delimiters in page text', () => {
    expect(buildPdf(['a (b) \\c']).toString('ascii')).toContain(
      '(a \\(b\\) \\\\c) Tj',
    );
  });
});
