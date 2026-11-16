/**
 * @module convert/convert-pdf-to-png
 *
 * The runnable `convert-pdf-to-png` (Decision 83.1), with arguments
 * `<in> <outDir> [--pages <list>] [--scale <n>]`: renders pages of one
 * PDF to `<outDir>/<input basename>-p<N>.png` with {@link renderPdfPages}, and
 * prints one line per page. No manifest; run on demand. Reads `<in>`,
 * writes the PNG files. A usage error, an unreadable input or a page list
 * outside the document fails the run.
 */

import { argOptional, positionalArgs } from '@karmaniverous/jeeves';

import { defineRunnable } from '../runnables/define-runnable.js';
import { renderPdfPages } from './pdf-to-png.js';

const USAGE =
  'Usage: jeeves-scripts run convert-pdf-to-png <in> <outDir> [--pages <list>] [--scale <n>]';

/** The flags `convert-pdf-to-png` accepts. */
const flags = {
  pages: argOptional('--pages', {
    description: '1-based pages to render, e.g. 1-3,7 (default: all)',
  }),
  scale: argOptional('--scale', {
    description: 'Render scale; 1 is 72 pixels per inch (default: 1.5)',
  }),
};

export default defineRunnable({
  id: 'convert-pdf-to-png',
  domain: 'convert',
  description:
    'Render pages of one .pdf file to PNG: <in> <outDir> [--pages 1-3,7] [--scale 1.5].',
  flags,
  positionals: '<input.pdf> <outDir>',
  run: async ({ args, flags: { pages, scale } }) => {
    const positionals = positionalArgs(args, flags);
    const [input, outDir] = positionals;
    if (positionals.length !== 2 || !input || !outDir) throw new Error(USAGE);
    const rendered = await renderPdfPages(input, outDir, {
      pages,
      // renderPdfPages rejects a scale that is not a positive number
      // (`' '` is 0, a non-number NaN); the flag parser rejects `''`.
      scale: scale === undefined ? undefined : Number(scale),
    });
    for (const { page, file, width, height } of rendered)
      console.log(
        `RENDER ${input} page ${String(page)} -> ${file} (${String(width)}x${String(height)})`,
      );
  },
});
