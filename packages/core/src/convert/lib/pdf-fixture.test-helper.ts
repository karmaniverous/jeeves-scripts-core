/**
 * @module convert/lib/pdf-fixture.test-helper
 *
 * Builds small, deterministic PDFs for the convert tests: US Letter pages
 * (612 x 792 points), each either a line of Helvetica text or, for `null`,
 * a filled grey rectangle and no text (what a scanned page looks like to a
 * text extractor). The committed fixtures under `fixtures/` are this
 * builder's output (`pdf-fixture.test.ts` checks they still match); to
 * regenerate them, run `npx tsx scripts/write-pdf-fixtures.ts` from
 * `packages/core`.
 */

/** Page width in points. */
export const PAGE_WIDTH = 612;
/** Page height in points. */
export const PAGE_HEIGHT = 792;

/** Escape a string for a PDF literal string. */
const pdfString = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`);

/** A page's content stream. */
const contentStream = (text: string | null) =>
  text === null
    ? '0.6 g 72 72 468 648 re f'
    : `BT /F1 12 Tf 72 720 Td (${pdfString(text)}) Tj ET`;

/**
 * Build a PDF.
 *
 * @param pages - One entry per page: its text, or `null` for a page with
 *   no text (a grey rectangle).
 * @returns The PDF bytes (ASCII, LF line ends).
 */
export function buildPdf(pages: readonly (string | null)[]): Buffer {
  const pageIds = pages.map((_, i) => 4 + i * 2);
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${String(id)} 0 R`).join(' ')}] /Count ${String(pages.length)} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  pages.forEach((text, i) => {
    const stream = contentStream(text);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(PAGE_WIDTH)} ${String(PAGE_HEIGHT)}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(5 + i * 2)} 0 R >>`,
      `<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`,
    );
  });

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${String(i + 1)} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Buffer.from(body, 'ascii');
}

/** The fixtures under `fixtures/`, by file name. */
export const pdfFixtures: Readonly<Record<string, readonly (string | null)[]>> =
  {
    'three-pages.pdf': [
      'Page one of the sample document, with enough text to extract.',
      'Page two of the sample document, with enough text to extract.',
      'Page three of the sample document, with enough text to extract.',
    ],
    'textless-page.pdf': [
      'Page one of the sample document, with enough text to extract.',
      null,
      'Page three of the sample document, with enough text to extract.',
    ],
  };
