/**
 * @module convert/pdf-to-png
 *
 * `renderPdfPages(input, outDir, options)`, a public utility (Decision
 * 83.1): renders selected pages of a PDF to PNG files an agent can look at
 * (`view_image`), with no Python or system packages. Writes
 * `<outDir>/<input basename>-p<N>.png`, creating `outDir` and overwriting
 * files. Reads and writes the filesystem; logs nothing (the
 * `convert-pdf-to-png` runnable prints one line per page).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { type PageRange, parsePageList, selectPages } from './lib/page-list.js';

/** The default render scale (Decision 83.1). */
const DEFAULT_PDF_SCALE = 1.5;

/** Options for {@link renderPdfPages}. */
export interface RenderPdfPagesOptions {
  /**
   * The pages to render, 1-based: a page list such as `1-3,7`, or page
   * numbers. Default: every page.
   */
  pages?: string | readonly number[];
  /** Render scale; 1 is 72 pixels per inch. Default: 1.5. */
  scale?: number;
}

/** One page written by {@link renderPdfPages}. */
export interface RenderedPdfPage {
  /** 1-based page number. */
  page: number;
  /** The PNG file written. */
  file: string;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
}

/** The selected ranges, and how to name them in an error. */
const toRanges = (
  pages: RenderPdfPagesOptions['pages'],
): { ranges?: PageRange[]; label: string } => {
  if (pages === undefined) return { label: 'all' };
  if (typeof pages === 'string')
    return { ranges: parsePageList(pages), label: pages };
  if (
    pages.length === 0 ||
    pages.some((page) => !Number.isInteger(page) || page < 1)
  )
    throw new Error(
      `Invalid pages [${pages.join(',')}]: use one or more 1-based page numbers`,
    );
  return {
    ranges: pages.map((page) => [page, page] as const),
    label: pages.join(','),
  };
};

/**
 * Render pages of a PDF to PNG files.
 *
 * @param input - The PDF file.
 * @param outDir - Directory for the PNG files (created when missing).
 * @param options - Pages and scale.
 * @returns The pages written, ascending.
 * @throws When the page list or scale is invalid, the input can't be read
 *   or parsed, or a selected page is outside the document; nothing is
 *   written then.
 *
 * @example
 * ```ts
 * import { renderPdfPages } from '@karmaniverous/jeeves-scripts-core';
 *
 * const pages = await renderPdfPages('/base/docs/spec.pdf', '/base/tmp', {
 *   pages: '1-3,7',
 * });
 * ```
 */
export async function renderPdfPages(
  input: string,
  outDir: string,
  options: RenderPdfPagesOptions = {},
): Promise<RenderedPdfPage[]> {
  const { scale = DEFAULT_PDF_SCALE } = options;
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error(`Invalid scale ${String(scale)}: use a positive number`);
  const { ranges, label } = toRanges(options.pages);
  const data = readFileSync(input);

  // Loaded on first use, so importing the root export stays cheap.
  const { renderPdf } = await import('./lib/pdf-render.js');
  const images = await renderPdf(
    data,
    (total) => selectPages(ranges, total, label),
    scale,
  );

  mkdirSync(outDir, { recursive: true });
  const base = path.basename(input, path.extname(input));
  return images.map(({ page, png, width, height }) => {
    const file = path.join(outDir, `${base}-p${String(page)}.png`);
    writeFileSync(file, png);
    return { page, file, width, height };
  });
}
