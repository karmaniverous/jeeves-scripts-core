/**
 * renderPdfPages and the convert-pdf-to-png runnable against real PDFs
 * (the fixtures under lib/fixtures), rendered with pdf-parse and
 * `@napi-rs/canvas`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import convertPdfToPngJob from './convert-pdf-to-png.js';
import { PAGE_HEIGHT, PAGE_WIDTH } from './lib/pdf-fixture.test-helper.js';
import { renderPdfPages } from './pdf-to-png.js';

const FIXTURE = path.join(import.meta.dirname, 'lib/fixtures/three-pages.pdf');
const PNG_SIGNATURE = '89504e470d0a1a0a';
const USAGE =
  'Usage: jeeves-scripts run convert-pdf-to-png <in> <outDir> [--pages <list>] [--scale <n>]';

/** A PNG file's signature and IHDR dimensions. */
const pngHeader = (file: string) => {
  const bytes = fs.readFileSync(file);
  return {
    signature: bytes.subarray(0, 8).toString('hex'),
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
};

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-to-png-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('renderPdfPages', () => {
  it('renders every page at scale 1.5 by default, creating outDir', async () => {
    const outDir = path.join(dir, 'nested', 'out');

    const pages = await renderPdfPages(FIXTURE, outDir);

    expect(pages.map(({ page, file }) => [page, file])).toEqual(
      [1, 2, 3].map((n) => [
        n,
        path.join(outDir, `three-pages-p${String(n)}.png`),
      ]),
    );
    expect(fs.readdirSync(outDir).sort()).toEqual([
      'three-pages-p1.png',
      'three-pages-p2.png',
      'three-pages-p3.png',
    ]);
    for (const { file, width, height } of pages) {
      expect(pngHeader(file)).toEqual({
        signature: PNG_SIGNATURE,
        width: PAGE_WIDTH * 1.5,
        height: PAGE_HEIGHT * 1.5,
      });
      expect([width, height]).toEqual([PAGE_WIDTH * 1.5, PAGE_HEIGHT * 1.5]);
    }
  });

  it('renders only the listed pages, at the given scale, overwriting files', async () => {
    const stale = path.join(dir, 'three-pages-p3.png');
    fs.writeFileSync(stale, 'old');

    const pages = await renderPdfPages(FIXTURE, dir, {
      pages: '3,1',
      scale: 1,
    });

    expect(pages.map(({ page }) => page)).toEqual([1, 3]);
    expect(fs.readdirSync(dir).sort()).toEqual([
      'three-pages-p1.png',
      'three-pages-p3.png',
    ]);
    expect(pngHeader(stale)).toEqual({
      signature: PNG_SIGNATURE,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
    });
  });

  it('dimensions scale with the scale', async () => {
    const [small] = await renderPdfPages(FIXTURE, dir, {
      pages: [2],
      scale: 0.5,
    });
    const [large] = await renderPdfPages(FIXTURE, path.join(dir, 'big'), {
      pages: [2],
      scale: 2,
    });

    expect(small && pngHeader(small.file)).toMatchObject({
      width: PAGE_WIDTH / 2,
      height: PAGE_HEIGHT / 2,
    });
    expect(large && pngHeader(large.file)).toMatchObject({
      width: PAGE_WIDTH * 2,
      height: PAGE_HEIGHT * 2,
    });
  });

  it('rejects a page list outside the document and writes nothing', async () => {
    const outDir = path.join(dir, 'out');

    await expect(
      renderPdfPages(FIXTURE, outDir, { pages: '2-4' }),
    ).rejects.toThrow('Page list 2-4 is outside the document (3 pages)');
    await expect(
      renderPdfPages(FIXTURE, outDir, { pages: [1, 9] }),
    ).rejects.toThrow('Page list 1,9 is outside the document (3 pages)');
    expect(fs.existsSync(outDir)).toBe(false);
  });

  it.each([[[]], [[0]], [[1.5]]])('rejects page numbers %j', async (pages) => {
    await expect(renderPdfPages(FIXTURE, dir, { pages })).rejects.toThrow(
      /use one or more 1-based page numbers/,
    );
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects scale %d',
    async (scale) => {
      await expect(renderPdfPages(FIXTURE, dir, { scale })).rejects.toThrow(
        /use a positive number/,
      );
    },
  );

  it('rejects an invalid page list before reading the input', async () => {
    await expect(
      renderPdfPages(path.join(dir, 'missing.pdf'), dir, { pages: '1-' }),
    ).rejects.toThrow('Invalid page list "1-"');
  });

  it('fails on a missing or malformed input', async () => {
    await expect(
      renderPdfPages(path.join(dir, 'missing.pdf'), dir),
    ).rejects.toThrow(/ENOENT/);

    const junk = path.join(dir, 'junk.pdf');
    fs.writeFileSync(junk, 'not a pdf');
    await expect(renderPdfPages(junk, path.join(dir, 'out'))).rejects.toThrow();
    expect(fs.existsSync(path.join(dir, 'out'))).toBe(false);
  });
});

describe('convert-pdf-to-png', () => {
  it('renders the selected pages and prints one line per page', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await convertPdfToPngJob.run({
      args: [FIXTURE, dir, '--pages', '1-2', '--scale', '1'],
    });

    expect(fs.readdirSync(dir).sort()).toEqual([
      'three-pages-p1.png',
      'three-pages-p2.png',
    ]);
    expect(log.mock.calls).toEqual(
      [1, 2].map((n) => [
        `RENDER ${FIXTURE} page ${String(n)} -> ${path.join(dir, `three-pages-p${String(n)}.png`)} (${String(PAGE_WIDTH)}x${String(PAGE_HEIGHT)})`,
      ]),
    );
  });

  it('renders every page at scale 1.5 without flags', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await convertPdfToPngJob.run({ args: [FIXTURE, dir] });

    expect(fs.readdirSync(dir)).toHaveLength(3);
    expect(pngHeader(path.join(dir, 'three-pages-p1.png')).width).toBe(
      PAGE_WIDTH * 1.5,
    );
  });

  it.each([[[]], [[FIXTURE]], [[FIXTURE, 'out', 'extra']], [['--pages', '1']]])(
    'rejects positionals other than <in> <outDir>: %j',
    async (args) => {
      await expect(convertPdfToPngJob.run({ args })).rejects.toThrow(USAGE);
    },
  );

  it.each(['0', 'big', ' '])('rejects --scale %j', async (scale) => {
    await expect(
      convertPdfToPngJob.run({ args: [FIXTURE, dir, '--scale', scale] }),
    ).rejects.toThrow(
      `Invalid --scale ${scale}: use a positive number\n${USAGE}`,
    );
  });

  it('fails on a page list outside the document', async () => {
    await expect(
      convertPdfToPngJob.run({ args: [FIXTURE, dir, '--pages', '4'] }),
    ).rejects.toThrow('Page list 4 is outside the document (3 pages)');
  });
});
