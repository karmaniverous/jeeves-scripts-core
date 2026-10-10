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

const docs = [...shipped('docs'), ...shipped('guides')];

describe('package documentation', () => {
  it('ships docs/, guides/, schema/ and config/ in the package', () => {
    expect(pkg.files).toEqual(
      expect.arrayContaining(['docs', 'guides', 'schema', 'config']),
    );
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
    const linked = [...readme.matchAll(/\]\(((?:docs|guides)\/[^)#]+)\)/g)]
      .map((m) => m[1] ?? '')
      .filter((target) => target.endsWith('.md'));
    expect(linked.length).toBeGreaterThan(0);
    const missing = linked.filter(
      (target) => !fs.existsSync(path.join(pkgRoot, target)),
    );
    expect(missing).toEqual([]);
  });
});
