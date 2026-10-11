/**
 * Instance-agnostic guard (Decisions 18, 36; Verification Checklist): core
 * is published publicly, so nothing in it may identify a particular
 * instance. Scans core's source, guides, skills, tests, scripts and README
 * and the template package against the deny list in
 * `instance-agnostic.deny-list.ts` and fails on every hit, naming the
 * file, line and rule. A hard release gate: CI runs it on Linux and
 * Windows.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  denyRules,
  looksLikeRealSlackId,
} from './instance-agnostic.deny-list.js';

const pkgRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const repoRoot = path.resolve(pkgRoot, '..', '..');

/** What the guard scans, relative to the repo root. */
const SCAN_ROOTS = [
  'packages/core/src',
  'packages/core/guides',
  'packages/core/skills',
  'packages/core/test',
  'packages/core/scripts',
  'packages/core/jobs',
  'packages/core/README.md',
  'packages/template',
];

/** Never scanned: build output, dependencies, and the deny list itself. */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.rollup.cache',
  'coverage',
]);
const SELF = new Set([
  path.join(pkgRoot, 'test', 'instance-agnostic.deny-list.ts'),
  path.join(pkgRoot, 'test', 'instance-agnostic.test.ts'),
]);
const TEXT = /\.(ts|js|cjs|mjs|json|md|txt|ya?ml)$/;

const walk = (p: string): string[] => {
  if (!fs.existsSync(p)) return [];
  const stat = fs.statSync(p);
  if (stat.isFile()) return TEXT.test(p) ? [p] : [];
  return fs
    .readdirSync(p, { withFileTypes: true })
    .filter((e) => !(e.isDirectory() && SKIP_DIRS.has(e.name)))
    .flatMap((e) => walk(path.join(p, e.name)));
};

/** One deny-list hit. */
interface Hit {
  file: string;
  line: number;
  rule: string;
  text: string;
}

/** Every deny-list hit in `text` (one file's content). */
const scanText = (file: string, text: string): Hit[] =>
  text.split(/\r?\n/).flatMap((line, i) =>
    denyRules.flatMap((rule) => {
      const flags = rule.pattern.flags.includes('g')
        ? rule.pattern.flags
        : `${rule.pattern.flags}g`;
      return [...line.matchAll(new RegExp(rule.pattern.source, flags))]
        .map((m) => m[0])
        .filter((m) => rule.accept?.(m) ?? true)
        .map((m) => ({ file, line: i + 1, rule: rule.id, text: m }));
    }),
  );

describe('instance-agnostic guard', () => {
  const files = SCAN_ROOTS.flatMap((r) => walk(path.join(repoRoot, r))).filter(
    (f) => !SELF.has(f),
  );

  it('scans core and the template', () => {
    expect(files.some((f) => f.includes(`${path.sep}src${path.sep}`))).toBe(
      true,
    );
    expect(files.some((f) => f.endsWith('.md'))).toBe(true);
    expect(files.some((f) => f.includes(`template${path.sep}`))).toBe(true);
  });

  it('finds no instance-identifying text', () => {
    const hits = files.flatMap((f) =>
      scanText(path.relative(repoRoot, f), fs.readFileSync(f, 'utf8')),
    );
    expect(
      hits.map((h) => `${h.file}:${String(h.line)} [${h.rule}] ${h.text}`),
    ).toEqual([]);
  });
});

describe('deny rules', () => {
  // Fragments are joined at run time so this file holds no hit itself.
  const j = (...parts: string[]) => parts.join('');
  const cases: [string, string | null][] = [
    [j('owned by ', 'J', 'GS'), 'instance-name'],
    [j('bot ', 'jgs', '-jeeves'), 'instance-name'],
    [j('base ', 'j', ':/domains'), 'instance-drive'],
    [j('C', ':', '\\', 'Users'), null],
    [j('veteran', 'crowd', '.com'), 'client-name'],
    [j('jane@', 'john', 'galt.id'), 'instance-domain'],
    [j("account: '", 'karma', "niverous'"), 'owner-account'],
    [j('@', 'karma', 'niverous/jeeves'), null],
    [j('karma', 'niverous/jeeves-tools#184'), null],
    [j('github.com/', 'karma', 'niverous'), null],
    [j('from ', 'Ja', 'son'), 'person-name'],
    [j('channel ', 'C0B3', 'CHY4QKX'), 'slack-id'],
    ['channel C000EXAMPLE1', null],
    ['channel C0123456789', null],
    [j('page ', '0123456789abcdef', '0123456789abcdef'), 'notion-id'],
    [
      j('file ', '1AcmeExampleDrive', 'FileId000000000000000000000'),
      'google-drive-id',
    ],
    ['Jane Doe <jane@example.com>, acme, /base', null],
  ];

  it.each(cases)('%s -> %s', (text, rule) => {
    const hits = scanText('x', text).map((h) => h.rule);
    expect(hits).toEqual(rule ? [rule] : []);
  });

  it('treats placeholder Slack ids as placeholders', () => {
    expect(looksLikeRealSlackId('U0JANE0001')).toBe(false);
    expect(looksLikeRealSlackId('C0000000000')).toBe(false);
    expect(looksLikeRealSlackId(j('U02', 'PQFM6NTH'))).toBe(true);
  });
});
