/**
 * The `library` block (spec 2.9): field rules, defaults, and the
 * config check (Decision 76: no block passes; an invalid block fails).
 */

import { describe, expect, it } from 'vitest';

import { configCheck } from './check.js';
import { useConfigFile } from './config-file.test-helper.js';
import { generateJsonSchema } from './json-schema.js';
import { libraryMirrorSchema, librarySchema } from './library-schema.js';

const mirror = { id: 'docs', repo: 'acme/docs', dest: 'library/docs' };
const issues = (value: unknown, schema = libraryMirrorSchema): string[] => {
  const r = schema.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe('libraryMirrorSchema', () => {
  it('applies the defaults', () => {
    expect(libraryMirrorSchema.parse(mirror)).toEqual({
      ...mirror,
      ref: 'main',
      subdir: '',
      exclude: [],
      minRatio: 0.5,
      adopt: false,
    });
    expect(libraryMirrorSchema.parse({ ...mirror, adopt: true }).adopt).toBe(
      true,
    );
  });

  it.each([
    ['id', { id: 'Docs' }, /lowercase/],
    ['repo', { repo: 'acme' }, /owner\/repo/],
    ['ref', { ref: '' }, /too small|>=1/i],
    ['ref', { ref: '--upload-pack=x' }, /must not start with -/],
    ['subdir', { subdir: '/abs' }, /relative/],
    ['subdir', { subdir: 'a/../b' }, /\.\. segment/],
    ['dest', { dest: '/abs' }, /relative/],
    ['dest', { dest: 'C:\\content' }, /relative/],
    ['dest', { dest: '../outside' }, /\.\. segment/],
    ['dest', { dest: './' }, /directory under the content dir/],
    ['dest', { dest: 'library/.meta/x' }, /under \.meta/],
    // Case-insensitive filesystems put `.Meta` at `.meta`.
    ['dest', { dest: 'library/.Meta/x' }, /under \.meta/],
    ['dest', { dest: '.META' }, /under \.meta/],
    ['minRatio', { minRatio: 0 }, /too small|>0/i],
    ['minRatio', { minRatio: 1.5 }, /too big|<=1/i],
    ['adopt', { adopt: 'yes' }, /expected boolean/i],
    [
      'siteLinks',
      { siteLinks: { pattern: '/s/', target: '{dir}/A.md' } },
      /exactly one \{name\}/,
    ],
    [
      'siteLinks',
      { siteLinks: { pattern: '/s/{name}/{name}', target: '{dir}/A.md' } },
      /exactly one \{name\}/,
    ],
    [
      'siteLinks',
      { siteLinks: { pattern: '/s/{name}', target: 'A.md' } },
      /exactly one \{dir\}/,
    ],
    [
      'siteLinks',
      { siteLinks: { pattern: '/s/{name}', target: '{dir}/{name}.md' } },
      /exactly one \{dir\} and no \{name\}/,
    ],
  ])('rejects an invalid %s (%o)', (_key, patch, message) => {
    expect(issues({ ...mirror, ...patch }).join('\n')).toMatch(message);
  });

  it('accepts a full mirror with site links', () => {
    expect(
      issues({
        ...mirror,
        ref: 'v1.2',
        subdir: 'skills',
        exclude: ['.system/'],
        minRatio: 1,
        siteLinks: { pattern: '/skill/{name}', target: '{dir}/SKILL.md' },
      }),
    ).toEqual([]);
  });
});

describe('librarySchema', () => {
  const mirrors = (...ms: object[]) =>
    issues({ mirrors: ms }, librarySchema as never);

  it('defaults to no mirrors', () => {
    expect(librarySchema.parse({})).toEqual({ mirrors: [] });
  });

  it('rejects a duplicate id', () => {
    expect(mirrors(mirror, { ...mirror, dest: 'other' })).toEqual([
      'duplicate mirror id "docs"',
    ]);
  });

  it('rejects two mirrors sharing a dest, however written', () => {
    expect(
      mirrors(mirror, { ...mirror, id: 'b', dest: './library//docs/' }),
    ).toEqual([
      `dest "./library//docs/" overlaps mirror "docs"'s dest "library/docs"`,
    ]);
  });

  it("rejects a dest inside, or around, another mirror's", () => {
    expect(
      mirrors(mirror, { ...mirror, id: 'b', dest: 'library/docs/sub' }),
    ).toHaveLength(1);
    expect(
      mirrors(mirror, { ...mirror, id: 'b', dest: 'library' }),
    ).toHaveLength(1);
    expect(
      mirrors(mirror, { ...mirror, id: 'b', dest: 'library/docs2' }),
    ).toEqual([]);
  });
});

describe('config check and the library block', () => {
  const write = useConfigFile();

  it('passes with no block', () => {
    expect(configCheck(write({})).ok).toBe(true);
  });

  it.each([
    [
      'a duplicate mirror id',
      [mirror, { ...mirror, dest: 'other' }],
      /duplicate mirror id/,
    ],
    ['a dest under .meta', [{ ...mirror, dest: '.meta/docs' }], /under \.meta/],
    [
      'two mirrors sharing a dest',
      [mirror, { ...mirror, id: 'b' }],
      /overlaps mirror "docs"/,
    ],
  ])('fails on %s', (_what, mirrors, message) => {
    const result = configCheck(write({ library: { mirrors } }));
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(message);
  });

  it('appears in the generated JSON Schema', () => {
    const schema = generateJsonSchema() as {
      properties: Record<string, unknown>;
    };
    expect(schema.properties).toHaveProperty('library');
  });
});
