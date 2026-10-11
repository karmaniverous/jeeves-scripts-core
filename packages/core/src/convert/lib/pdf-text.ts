/**
 * @module convert/lib/pdf-text
 *
 * Text extraction for convert/pdf-to-md. The pdf-parse parser is always
 * destroyed, including when extraction rejects (a malformed PDF), so a
 * batch of bad files doesn't accumulate parser resources.
 */

import { PDFParse } from 'pdf-parse';

/** Extracted text and page count. */
export interface PdfText {
  text: string;
  total: number;
}

/**
 * Extract the text of a PDF.
 *
 * @param data - PDF bytes.
 * @returns Text and page count.
 */
export async function extractPdfText(data: Buffer): Promise<PdfText> {
  const parser = new PDFParse({ data });
  try {
    const { text, total } = await parser.getText();
    return { text, total };
  } finally {
    await parser.destroy();
  }
}
