/**
 * @module convert/convert-docx-to-md
 *
 * The runnable `convert-docx-to-md <in> <out>` (Decision 51): converts one
 * `.docx` file to Markdown at `<out>`, a thin wrapper over the conversion
 * utility's extractor. No manifest; run on demand. Reads `<in>`, writes
 * `<out>`.
 */

import { defineJob } from '../jobs/define-job.js';
import { extractDocx } from './docx-to-md.js';
import { convertFileArgs } from './lib/convert-files.js';

export default defineJob({
  id: 'convert-docx-to-md',
  domain: 'convert',
  description: 'Convert one .docx file to Markdown: <in> <out>.',
  flags: {},
  positionals: '<input.docx> <output.md>',
  run: ({ args }) => convertFileArgs('convert-docx-to-md', args, extractDocx),
});
