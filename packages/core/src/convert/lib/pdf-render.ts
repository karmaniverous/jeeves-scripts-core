/**
 * @module convert/lib/pdf-render
 *
 * Page rendering for convert/pdf-to-png (Decision 83.1), with pdf-parse's
 * `getScreenshot` (canvas from `@napi-rs/canvas`, a pdf-parse dependency).
 * The parser is always destroyed, including when the selection or the
 * rendering rejects.
 */

import { PDFParse } from 'pdf-parse';

/** One rendered page. */
export interface PageImage {
  /** 1-based page number. */
  page: number;
  /** PNG bytes. */
  png: Uint8Array;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
}

/**
 * Render pages of a PDF to PNG.
 *
 * @param data - PDF bytes.
 * @param select - Given the page count, the pages to render; may throw to
 *   reject the selection before anything is rendered.
 * @param scale - Render scale (1 = 72 pixels per inch).
 * @returns The rendered pages, in the order selected.
 */
export async function renderPdf(
  data: Buffer,
  select: (total: number) => readonly number[],
  scale: number,
): Promise<PageImage[]> {
  const parser = new PDFParse({ data });
  try {
    const { total } = await parser.getInfo();
    const partial = [...select(total)];
    const { pages } = await parser.getScreenshot({
      partial,
      scale,
      imageDataUrl: false,
      imageBuffer: true,
    });
    return pages.map(({ pageNumber, data: png, width, height }) => ({
      page: pageNumber,
      png,
      width,
      height,
    }));
  } finally {
    await parser.destroy();
  }
}
