/**
 * @module convert/lib/pdf-text
 *
 * Text extraction for convert/pdf-to-md: the whole text, the page count
 * and each page's text (Decision 83.2). The pdf-parse parser is always
 * destroyed, including when extraction rejects (a malformed PDF), so a
 * batch of bad files doesn't accumulate parser resources.
 */

import { PDFParse } from 'pdf-parse';

/** One page's text. */
export interface PdfPageText {
  /** 1-based page number. */
  num: number;
  /** The page's text. */
  text: string;
}

/** Extracted text, page count and per-page text. */
export interface PdfText {
  text: string;
  total: number;
  pages: PdfPageText[];
}

/**
 * Extract the text of a PDF.
 *
 * @param data - PDF bytes.
 * @returns Text, page count and each page's text.
 */
export async function extractPdfText(data: Buffer): Promise<PdfText> {
  const parser = new PDFParse({ data });
  try {
    const { text, total, pages } = await parser.getText();
    return {
      text,
      total,
      pages: pages.map(({ num, text }) => ({ num, text })),
    };
  } finally {
    await parser.destroy();
  }
}
