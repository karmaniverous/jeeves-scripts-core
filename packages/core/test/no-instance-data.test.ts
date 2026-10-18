/**
 * This package is public: tests, fixtures and docs must not carry an
 * instance's real mailboxes or people. Every email address in the shipped
 * and test sources must use a reserved or placeholder domain below. A new
 * domain fails this test; add it only when it is a placeholder or a public
 * service (never a client's own domain), and anonymize copied fixtures.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['src', 'guides', 'skills', 'jobs', 'test', 'README.md'];
const SCANNED = /\.(ts|md|json|html|txt|eml)$/;

/** Reserved (RFC 2606 / 6761) names. */
const RESERVED = /(^|\.)(example(\.(com|org|net))?|test|invalid|localhost)$/;

/** Placeholder and public-service domains already in use. */
const ALLOWED = new Set([
  'x.com',
  'y.com',
  'b.com',
  'acme.com',
  'home.org',
  'other.org',
  'else.com',
  'else.org',
  'shop.com',
  'vendor.net',
  'partner.io',
  'google.com',
  'apollo.io',
  'fathom.video',
  'e.read.ai',
  'x.jsonl',
  'b.c',
  'c.d',
  'y.z',
]);

const ADDRESS = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;

const files = (p: string): string[] => {
  if (!fs.existsSync(p)) return [];
  if (fs.statSync(p).isFile()) return SCANNED.test(p) ? [p] : [];
  return fs
    .readdirSync(p)
    .filter((n) => n !== 'node_modules' && n !== 'dist')
    .flatMap((n) => files(path.join(p, n)));
};

describe('no instance data in the public package', () => {
  it('uses only reserved or placeholder email domains', () => {
    const offenders = ROOTS.flatMap((r) => files(path.join(pkg, r))).flatMap(
      (f) =>
        [...fs.readFileSync(f, 'utf8').matchAll(ADDRESS)]
          .map((m) => (m[1] ?? '').toLowerCase())
          .filter((d) => !RESERVED.test(d) && !ALLOWED.has(d))
          .map((d) => `${path.relative(pkg, f)}: @${d}`),
    );
    expect([...new Set(offenders)]).toEqual([]);
  });
});
