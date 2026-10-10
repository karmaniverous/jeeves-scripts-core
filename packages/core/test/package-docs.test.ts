/**
 * Package documentation guard (Decision 10): every doc and guide ships in
 * the package (`files`), resolves through the `exports` map from outside
 * the package (as a skill's `require.resolve` would), and is indexed in
 * the package README; every README index entry exists.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const pkgRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const pkg = z
  .object({ name: z.string(), files: z.array(z.string()) })
  .parse(
    JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')),
  );
const readme = fs.readFileSync(path.join(pkgRoot, 'README.md'), 'utf8');
const require = createRequire(import.meta.url);

const shipped = (dir: string): string[] =>
  fs
    .readdirSync(path.join(pkgRoot, dir))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `${dir}/${name}`);

const docs = shipped('guides');

/** Markdown without fenced code blocks. */
const prose = (file: string): string =>
  fs.readFileSync(file, 'utf8').replace(/^(~~~~|```)[\s\S]*?^\1/gm, '');

/** GitHub-style heading anchors of a Markdown file. */
const headingAnchors = (file: string): Set<string> => {
  const seen = new Map<string, number>();
  const anchors = new Set<string>();
  for (const [, heading = ''] of prose(file).matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = heading
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n ? `${base}-${String(n)}` : base);
  }
  return anchors;
};

/** Relative Markdown links of a file, resolved. */
const relativeLinks = (file: string) =>
  [...prose(file).matchAll(/\]\(([^)\s]+)\)/g)]
    .map(([, link = '']) => link)
    .filter((link) => !/^(https?|mailto):/.test(link))
    .map((link) => {
      const [rel = '', anchor] = link.split('#');
      return {
        link,
        target: rel ? path.resolve(path.dirname(file), rel) : file,
        anchor,
      };
    });

describe('package documentation', () => {
  it('ships guides/, schema/, config/ and the changelog in the package', () => {
    expect(pkg.files).toEqual(
      expect.arrayContaining(['guides', 'schema', 'config', 'CHANGELOG.md']),
    );
  });

  it('keeps authored docs out of docs/, which is TypeDoc output', () => {
    expect(fs.existsSync(path.join(pkgRoot, 'docs'))).toBe(false);
    expect(pkg.files).not.toContain('docs');
  });

  it.each(docs)('%s resolves through the exports map', (doc) => {
    expect(require.resolve(`${pkg.name}/${doc}`)).toBe(path.join(pkgRoot, doc));
  });

  it('package.json resolves, so skills can find the package root', () => {
    expect(require.resolve(`${pkg.name}/package.json`)).toBe(
      path.join(pkgRoot, 'package.json'),
    );
  });

  it.each(docs)('%s is linked from the package README', (doc) => {
    expect(readme).toContain(`](${doc})`);
  });

  it('every doc the README links exists', () => {
    const linked = [...readme.matchAll(/\]\((guides\/[^)#]+)\)/g)]
      .map((m) => m[1] ?? '')
      .filter((target) => target.endsWith('.md'));
    expect(linked.length).toBeGreaterThan(0);
    const missing = linked.filter(
      (target) => !fs.existsSync(path.join(pkgRoot, target)),
    );
    expect(missing).toEqual([]);
  });

  it.each(['README.md', ...docs])(
    '%s has no broken relative links or anchors',
    (doc) => {
      const file = path.join(pkgRoot, doc);
      const broken = relativeLinks(file).filter(({ target, anchor }) => {
        if (!fs.existsSync(target)) return true;
        return (
          anchor !== undefined &&
          target.endsWith('.md') &&
          !headingAnchors(target).has(anchor)
        );
      });
      expect(broken.map((l) => l.link)).toEqual([]);
    },
  );
});
