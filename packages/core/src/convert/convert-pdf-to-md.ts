/**
 * @module convert/convert-pdf-to-md
 *
 * The runnable `convert-pdf-to-md <in> <out>` (Decision 51): converts one
 * `.pdf` file to Markdown at `<out>`, a thin wrapper over the conversion
 * utility's extractor. No manifest; run on demand. Reads `<in>`, writes
 * `<out>`.
 */

import { defineJob } from '../jobs/define-job.js';
import { convertFileArgs } from './lib/convert-files.js';
import { extractPdf } from './pdf-to-md.js';

export default defineJob({
  id: 'convert-pdf-to-md',
  domain: 'convert',
  description: 'Convert one .pdf file to Markdown: <in> <out>.',
  flags: {},
  positionals: '<input.pdf> <output.md>',
  run: ({ args }) => convertFileArgs('convert-pdf-to-md', args, extractPdf),
});
