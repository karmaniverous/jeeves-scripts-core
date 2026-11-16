/**
 * Writes the convert tests' PDF fixtures (`src/convert/lib/fixtures/*.pdf`)
 * from the deterministic builder in `pdf-fixture.test-helper.ts`. Run from
 * `packages/core`: `npx tsx scripts/write-pdf-fixtures.ts`. The output is
 * byte-for-byte reproducible; `pdf-fixture.test.ts` fails when a committed
 * fixture drifts from the builder.
 *
 * @module scripts/write-pdf-fixtures
 */

import { writeFileSync } from 'node:fs';

import {
  buildPdf,
  pdfFixtures,
} from '../src/convert/lib/pdf-fixture.test-helper.js';

for (const [name, pages] of Object.entries(pdfFixtures)) {
  const file = new URL(`../src/convert/lib/fixtures/${name}`, import.meta.url);
  writeFileSync(file, buildPdf(pages));
  console.log(`wrote ${name}`);
}
