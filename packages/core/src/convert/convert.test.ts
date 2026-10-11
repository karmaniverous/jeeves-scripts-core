import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  convertToHtml: vi.fn(),
  extractPdfText: vi.fn(),
}));
vi.mock('mammoth', () => ({
  default: { convertToHtml: mocks.convertToHtml },
}));
vi.mock('./lib/pdf-text.js', () => ({ extractPdfText: mocks.extractPdfText }));

import { convertDocxToMd } from './docx-to-md.js';
import { convertPdfToMd } from './pdf-to-md.js';

describe('conversion utilities', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('convertDocxToMd writes .docx.md from mammoth HTML as Markdown', async () => {
    fs.writeFileSync(path.join(dir, 'a.docx'), 'x');
    fs.writeFileSync(path.join(dir, 'b.pdf'), 'x');
    mocks.convertToHtml.mockResolvedValue({
      value:
        '<h1>Title</h1><p>Hi <strong>you</strong> &amp; me</p><ul><li>one</li></ul>',
    });

    expect(await convertDocxToMd([dir])).toEqual({
      converted: 1,
      skipped: 0,
      failed: 0,
    });
    const md = fs.readFileSync(path.join(dir, 'a.docx.md'), 'utf8');
    expect(md).toContain('# Title');
    expect(md).toContain('Hi **you** & me');
    expect(md).toContain('- one');
    expect(fs.existsSync(path.join(dir, 'b.pdf.md'))).toBe(false);
  });

  it('convertPdfToMd writes .pdf.md with the page count', async () => {
    fs.writeFileSync(path.join(dir, 'b.pdf'), 'x');
    mocks.extractPdfText.mockResolvedValue({ text: 'pdf text', total: 3 });

    expect(await convertPdfToMd([dir])).toEqual({
      converted: 1,
      skipped: 0,
      failed: 0,
    });
    const md = fs.readFileSync(path.join(dir, 'b.pdf.md'), 'utf8');
    expect(md).toContain('pages: 3');
    expect(md).toContain('pdf text');
  });
});
