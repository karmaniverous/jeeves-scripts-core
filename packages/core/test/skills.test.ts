/**
 * Shipped skills guard (Decision 33): every `skills/<name>/SKILL.md` that
 * core ships has valid frontmatter, stays thin (behaviour lives in the
 * docs), names no instance path, and links only to files inside the
 * package, with valid anchors.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const pkgRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const skillsDir = path.join(pkgRoot, 'skills');

/** The skills core ships, in order. */
const EXPECTED = [
  'jeeves-calendar',
  'jeeves-daily-briefings',
  'jeeves-email',
  'jeeves-github',
  'jeeves-jira',
  'jeeves-linear',
  'jeeves-scripts',
  'jeeves-slack',
  'jeeves-token-metrics',
  'jeeves-x',
];

/** A thin skill fits on a screen or two. */
const MAX_LINES = 60;
const MAX_DESCRIPTION = 400;

const skills = fs
  .readdirSync(skillsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

const read = (name: string) =>
  fs.readFileSync(path.join(skillsDir, name, 'SKILL.md'), 'utf8');

const frontmatterSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().min(20).max(MAX_DESCRIPTION),
});

/** Parse the `---` block of simple `key: value` lines (folded `>` values joined). */
export function parseFrontmatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return {};
  const out: Record<string, string> = {};
  let key: string | undefined;
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const kv = /^([a-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1] ?? '';
      out[key] = (kv[2] ?? '').replace(/^>\s*$/, '');
    } else if (key && /^\s+\S/.test(line))
      out[key] = `${out[key] ?? ''} ${line.trim()}`.trim();
  }
  return out;
}

/** Markdown without fenced code blocks. */
const prose = (text: string) => text.replace(/^(~~~~|```)[\s\S]*?^\1/gm, '');

/** GitHub-style heading anchors (as package-docs.test). */
const headingAnchors = (file: string): Set<string> => {
  const seen = new Map<string, number>();
  const anchors = new Set<string>();
  for (const [, heading = ''] of prose(fs.readFileSync(file, 'utf8')).matchAll(
    /^#{1,6}\s+(.+)$/gm,
  )) {
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

/** Instance paths a shipped skill must not name. */
const INSTANCE_PATHS = [
  /(^|[\s`'"(])[A-Za-z]:[\\/]/m, // drive letters
  /\/opt\/jeeves\b/,
  /\/home\/[\w.-]+/,
  /\\\\[\w.-]+\\/, // UNC
  /~\/\.openclaw\b/,
];

/** Headings that mean a skill is restating behaviour the docs own. */
const BEHAVIOUR_HEADINGS =
  /^#{2,6}\s+(data flow|archive structure|entity file format|directory structure|key files|scripts|runner jobs|architecture|output format|api client)\b/im;

describe('shipped skills', () => {
  it('ships exactly the expected skills', () => {
    expect(skills).toEqual(EXPECTED);
  });

  it('ships skills/ in the package', () => {
    const files = z
      .object({ files: z.array(z.string()) })
      .parse(
        JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')),
      ).files;
    expect(files).toContain('skills');
  });

  it('parseFrontmatter reads plain and folded values', () => {
    expect(
      parseFrontmatter('---\nname: a\ndescription: >\n  b c\n  d\n---\nx'),
    ).toEqual({ name: 'a', description: 'b c d' });
    expect(parseFrontmatter('no frontmatter')).toEqual({});
  });

  describe.each(skills)('%s', (name) => {
    const text = read(name);

    it('has frontmatter whose name matches its directory', () => {
      const fm = frontmatterSchema.parse(parseFrontmatter(text));
      expect(fm.name).toBe(name);
    });

    it(`stays thin (at most ${String(MAX_LINES)} lines, no behaviour sections)`, () => {
      expect(text.split('\n').length).toBeLessThanOrEqual(MAX_LINES);
      expect(text).not.toMatch(BEHAVIOUR_HEADINGS);
    });

    it('points at core documentation', () => {
      expect(text).toMatch(/\]\(\.\.\/\.\.\/(docs|guides)\/[\w-]+\.md/);
    });

    it('names no instance path', () => {
      const hits = INSTANCE_PATHS.filter((re) => re.test(text)).map(String);
      expect(hits).toEqual([]);
    });

    it('links only to files inside the package, with valid anchors', () => {
      const file = path.join(skillsDir, name, 'SKILL.md');
      const broken = [...prose(text).matchAll(/\]\(([^)\s]+)\)/g)]
        .map(([, link = '']) => link)
        .filter((link) => !/^(https?|mailto):/.test(link))
        .filter((link) => {
          const [rel = '', anchor] = link.split('#');
          const target = rel ? path.resolve(path.dirname(file), rel) : file;
          if (path.relative(pkgRoot, target).startsWith('..')) return true;
          if (!fs.existsSync(target)) return true;
          return (
            anchor !== undefined &&
            target.endsWith('.md') &&
            !headingAnchors(target).has(anchor)
          );
        });
      expect(broken).toEqual([]);
    });
  });
});
