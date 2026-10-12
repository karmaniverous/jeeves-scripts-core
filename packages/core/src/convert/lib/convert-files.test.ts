import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { convertFiles } from './convert-files.js';

describe('convertFiles', () => {
  let dir: string;
  const now = () => new Date('2026-01-02T03:04:05.000Z');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-files-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('converts stale files, skips up-to-date ones and counts failures', async () => {
    const fresh = path.join(dir, 'fresh.pdf');
    const stale = path.join(dir, 'sub', 'stale.pdf');
    const bad = path.join(dir, 'bad.pdf');
    fs.mkdirSync(path.dirname(stale));
    for (const f of [fresh, stale, bad]) fs.writeFileSync(f, f);
    fs.writeFileSync(`${fresh}.md`, 'old');
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(`${fresh}.md`, later, later);

    const extract = vi.fn((data: Buffer) =>
      data.toString().endsWith('bad.pdf')
        ? Promise.reject(new Error('corrupt'))
        : Promise.resolve({ content: 'body', frontmatter: { pages: 2 } }),
    );

    const result = await convertFiles(
      [dir, path.join(dir, 'missing')],
      '.pdf',
      extract,
      now,
    );

    expect(result).toEqual({ converted: 1, skipped: 1, failed: 1 });
    expect(fs.readFileSync(`${fresh}.md`, 'utf8')).toBe('old');
    expect(fs.existsSync(`${bad}.md`)).toBe(false);
    const out = fs.readFileSync(`${stale}.md`, 'utf8');
    expect(out).toContain('converted: "2026-01-02T03:04:05.000Z"');
    expect(out).toContain('pages: 2');
    expect(out.endsWith('body\n')).toBe(true);
    expect(console.log).toHaveBeenCalledWith(`FAIL ${bad}: corrupt`);
    expect(console.log).toHaveBeenLastCalledWith(
      'Converted: 1, Skipped: 1, Failed: 1',
    );
  });
});
