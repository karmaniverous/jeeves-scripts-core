/**
 * Text-less pages (Decision 83.2) in `convertPdfToMd` and the
 * `convert-pdf-to-md` runnable, against real PDFs (the fixtures under
 * lib/fixtures, extracted with pdf-parse).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';

import convertPdfJob from './convert-pdf-to-md.js';
import { convertPdfToMd } from './pdf-to-md.js';

const fixture = (name: string) =>
  path.join(import.meta.dirname, 'lib/fixtures', name);

/** The frontmatter block of a converted file. */
const frontmatter = (file: string) =>
  /^---\n([\s\S]*?)\n---\n/.exec(fs.readFileSync(file, 'utf8'))?.[1] ?? '';

let dir: string;
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-to-md-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('text-less pages', () => {
  it('convertPdfToMd lists a text-less page and warns, naming the file', async () => {
    const input = path.join(dir, 'scan.pdf');
    fs.copyFileSync(fixture('textless-page.pdf'), input);

    expect(await convertPdfToMd([dir])).toEqual({
      converted: 1,
      skipped: 0,
      failed: 0,
    });

    const fields = frontmatter(`${input}.md`);
    expect(fields).toContain('pages: 3');
    expect(fields).toContain('textlessPages: [2]');
    expect(warn.mock.calls).toEqual([
      [
        `WARN ${input}: text-less page 2 (fewer than 20 non-whitespace characters; scanned or image-only?)`,
      ],
    ]);
    expect(fs.readFileSync(`${input}.md`, 'utf8')).toContain(
      'Page three of the sample document',
    );
  });

  it('a text PDF gets no textlessPages field and no warning', async () => {
    const input = path.join(dir, 'text.pdf');
    fs.copyFileSync(fixture('three-pages.pdf'), input);

    await convertPdfToMd([dir]);

    const fields = frontmatter(`${input}.md`);
    expect(fields).toContain('pages: 3');
    expect(fields).not.toContain('textlessPages');
    expect(warn).not.toHaveBeenCalled();
  });

  it('convert-pdf-to-md flags the page, warns, and still succeeds', async () => {
    const input = fixture('textless-page.pdf');
    const output = path.join(dir, 'out.md');

    await convertPdfJob.run({ args: [input, output] });

    expect(frontmatter(output)).toContain('textlessPages: [2]');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`WARN ${input}: text-less page 2 `),
    );
  });

  it('counts only non-whitespace characters, and names every text-less page', async () => {
    vi.resetModules();
    vi.doMock('./lib/pdf-text.js', () => ({
      extractPdfText: () =>
        Promise.resolve({
          text: '',
          total: 3,
          pages: [
            { num: 1, text: ' a b c d e f g h i j k l m n o p q r s \n ' }, // 19
            { num: 2, text: 'abcdefghij klmnopqrst' }, // 20
            { num: 3, text: '' },
          ],
        }),
    }));
    const { extractPdf } = await import('./pdf-to-md.js');

    const { frontmatter: fields } = await extractPdf(Buffer.from(''), 'x.pdf');

    expect(fields).toEqual({ pages: 3, textlessPages: [1, 3] });
    expect(warn).toHaveBeenCalledWith(
      'WARN x.pdf: text-less pages 1, 3 (fewer than 20 non-whitespace characters; scanned or image-only?)',
    );
    vi.doUnmock('./lib/pdf-text.js');
  });
});
