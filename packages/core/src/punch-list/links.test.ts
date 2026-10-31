import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  browseUrl,
  fileLink,
  markdownLink,
  readServerLinks,
  type ServerLinks,
} from './links.js';

const links: ServerLinks = {
  publicUrl: 'https://jeeves.example.com/',
  roots: {
    dev: resolve('/base/dev'),
    jeeves: resolve('/base'),
    openclaw: resolve('/home/user/.openclaw'),
  },
};

describe('browseUrl', () => {
  // Both verified against server_resolve_path on 2026-10-18.
  it.each([
    [
      resolve(
        '/base/content/email/threads/ana@example.com/18f0c2d4a6b8e0f1/18f0c2d4a6b8e0f1.json',
      ),
      'https://jeeves.example.com/browse/jeeves/content/email/threads/ana%40example.com/18f0c2d4a6b8e0f1/18f0c2d4a6b8e0f1.json',
    ],
    [
      resolve(
        '/base/content/slack/acme-admin (C000EXAMPL1)/1792133651.841589.json',
      ),
      'https://jeeves.example.com/browse/jeeves/content/slack/acme-admin%20(C000EXAMPL1)/1792133651.841589.json',
    ],
  ])('converts %s', (path, url) => {
    expect(browseUrl(links, path)).toBe(url);
  });

  it('picks the most specific root', () => {
    expect(
      browseUrl(
        {
          ...links,
          roots: { a: resolve('/base'), b: resolve('/base/jeeves') },
        },
        resolve('/base/jeeves/x.md'),
      ),
    ).toBe('https://jeeves.example.com/browse/b/x.md');
  });

  it('rejects paths outside every root, and roots themselves', () => {
    expect(browseUrl(links, resolve('/etc/passwd'))).toBeUndefined();
    expect(browseUrl(links, resolve('/base'))).toBeUndefined();
    expect(browseUrl(links, resolve('/basex/a'))).toBeUndefined();
  });
});

describe('browseUrl with Windows paths', () => {
  const win: ServerLinks = {
    publicUrl: 'https://jeeves.example.com',
    roots: { j: 'J:\\', c: 'C:\\base' },
  };

  it('links a file under a root on the same drive', () => {
    expect(browseUrl(win, 'J:\\content\\a b.md', path.win32)).toBe(
      'https://jeeves.example.com/browse/j/content/a%20b.md',
    );
    expect(browseUrl(win, 'c:\\base\\x.md', path.win32)).toBe(
      'https://jeeves.example.com/browse/c/x.md',
    );
  });

  it('drops a file on another drive instead of linking its absolute path', () => {
    expect(path.win32.relative('C:\\base', 'D:\\x\\f.md')).toBe('D:\\x\\f.md');
    expect(browseUrl(win, 'D:\\x\\f.md', path.win32)).toBeUndefined();
    expect(browseUrl(win, '\\\\host\\share\\f.md', path.win32)).toBeUndefined();
  });
});

describe('fileLink / markdownLink', () => {
  it('rejects a missing file', () => {
    expect(
      fileLink(links, resolve('/base/a.json'), () => false),
    ).toBeUndefined();
    expect(fileLink(links, resolve('/base/a.json'), () => true)).toBe(
      'https://jeeves.example.com/browse/jeeves/a.json',
    );
  });

  it('labels with the file name and escapes parentheses', () => {
    expect(
      markdownLink('https://h/browse/a%20(C1)/m.json', '/x/a (C1)/m.json'),
    ).toBe('[m](https://h/browse/a%20%28C1%29/m.json)');
  });
});

describe('readServerLinks', () => {
  it('reads publicUrl and roots from the server config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pl-links-'));
    const file = join(dir, 'config.json');
    writeFileSync(
      file,
      JSON.stringify({
        publicUrl: 'https://h.example',
        roots: { r: dir },
        port: 1,
      }),
    );
    expect(readServerLinks(file)).toMatchObject({
      publicUrl: 'https://h.example',
      roots: { r: dir },
    });
  });

  it('fails naming the missing server config', () => {
    const file = join(tmpdir(), 'pl-links-missing', 'config.json');
    expect(() => readServerLinks(file)).toThrow(
      `jeeves-server config not found at ${file}: the punch list links its files through jeeves-server`,
    );
  });
});

describe('markdownLink without a directory', () => {
  it('labels a bare file name', () => {
    expect(markdownLink('https://h/x', 'notes.md')).toBe(
      '[notes](https://h/x)',
    );
  });
});
