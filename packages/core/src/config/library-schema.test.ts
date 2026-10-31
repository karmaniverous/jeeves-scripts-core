/**
 * The `library` block (spec 2.9): field rules, defaults, and its shape in
 * the generated JSON Schema. `config check` against the block is proved
 * with the runnable in `library/sync-mirrors.config.test.ts`.
 */

import { describe, expect, it } from 'vitest';

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
    ).toEqual([
      `dest "library/docs/sub" overlaps mirror "docs"'s dest "library/docs"`,
    ]);
    expect(mirrors(mirror, { ...mirror, id: 'b', dest: 'library' })).toEqual([
      `dest "library" overlaps mirror "docs"'s dest "library/docs"`,
    ]);
    expect(
      mirrors(mirror, { ...mirror, id: 'b', dest: 'library/docs2' }),
    ).toEqual([]);
  });
});

describe('the library block in the generated JSON Schema', () => {
  it('describes each mirror: its fields, the required ones, the defaults and bounds, nothing else', () => {
    const schema = generateJsonSchema() as {
      properties: Record<string, { properties: Record<string, unknown> }>;
    };
    const library = schema.properties.library;
    expect(library).toMatchObject({
      type: 'object',
      default: { mirrors: [] },
      additionalProperties: false,
    });
    const item = (
      library?.properties.mirrors as {
        default: unknown;
        items: {
          properties: Record<string, unknown>;
          required: string[];
          additionalProperties: boolean;
        };
      }
    ).items;
    expect(Object.keys(item.properties).sort()).toEqual([
      'adopt',
      'dest',
      'exclude',
      'id',
      'minRatio',
      'ref',
      'repo',
      'siteLinks',
      'subdir',
    ]);
    expect(item.required).toEqual(
      expect.arrayContaining(['id', 'repo', 'dest']),
    );
    expect(item.required).not.toContain('siteLinks');
    expect(item.additionalProperties).toBe(false);
    expect(item.properties).toMatchObject({
      id: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
      ref: { type: 'string', default: 'main' },
      subdir: { type: 'string', default: '' },
      exclude: { type: 'array', default: [] },
      minRatio: {
        type: 'number',
        default: 0.5,
        exclusiveMinimum: 0,
        maximum: 1,
      },
      siteLinks: { type: 'object', required: ['pattern', 'target'] },
      adopt: { type: 'boolean', default: false },
    });
  });
});
