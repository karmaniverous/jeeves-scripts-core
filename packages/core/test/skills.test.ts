/**
 * Shipped skills guard (Decisions 33, 39; design §8): every
 * `skills/<name>/SKILL.md` that core ships has valid frontmatter declaring
 * `JEEVES_SCRIPTS_DIR`, stays thin (behaviour lives in the docs), names no
 * instance path, and points only at files inside the package through
 * `$JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/...`
 * paths that exist, with valid anchors.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const pkgRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const skillsDir = path.join(pkgRoot, 'skills');

/** The skills core ships, in order. */
const EXPECTED = [
  'channel-status-recap',
  'jeeves-calendar',
  'jeeves-daily-briefings',
  'jeeves-dates',
  'jeeves-email',
  'jeeves-github',
  'jeeves-jira',
  'jeeves-linear',
  'jeeves-scripts',
  'jeeves-slack',
  'jeeves-standing-meetings',
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

/** How a skill names a file in the installed core package. */
const PKG_PREFIX =
  '$JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/';

/** Every package path a skill names, in links or prose. */
const PKG_PATHS =
  /\$JEEVES_SCRIPTS_DIR\/node_modules\/@karmaniverous\/jeeves-scripts-core\/([^\s)`'"]*)/g;

const metadataSchema = z.object({
  openclaw: z.object({
    requires: z.object({ env: z.array(z.string()) }),
  }),
});

const frontmatterSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().min(20).max(MAX_DESCRIPTION),
  // OpenClaw parses the frontmatter as YAML and re-parses metadata as JSON5,
  // so Prettier's single-quoted YAML flow mapping is as valid as JSON.
  metadata: z.string().transform((s, ctx) => {
    const parsed = metadataSchema.safeParse(JSON5.parse(s));
    if (parsed.success) return parsed.data;
    ctx.addIssue({ code: 'custom', message: z.prettifyError(parsed.error) });
    return z.NEVER;
  }),
});

/** Whether a package-relative path (with an optional anchor) exists. */
const brokenPackagePath = (rest: string): boolean => {
  const [rel = '', anchor] = rest.split('#');
  const target = path.join(pkgRoot, rel);
  if (path.relative(pkgRoot, target).startsWith('..')) return true;
  if (!fs.existsSync(target)) return true;
  return (
    anchor !== undefined &&
    target.endsWith('.md') &&
    !headingAnchors(target).has(anchor)
  );
};

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

    it('has frontmatter whose name matches its directory and declares JEEVES_SCRIPTS_DIR', () => {
      const fm = frontmatterSchema.parse(parseFrontmatter(text));
      expect(fm.name).toBe(name);
      expect(fm.metadata.openclaw.requires.env).toContain('JEEVES_SCRIPTS_DIR');
    });

    it(`stays thin (at most ${String(MAX_LINES)} lines, no behaviour sections)`, () => {
      expect(text.split('\n').length).toBeLessThanOrEqual(MAX_LINES);
      expect(text).not.toMatch(BEHAVIOUR_HEADINGS);
    });

    it('points at core documentation', () => {
      expect(text).toContain(`](${PKG_PREFIX}guides/`);
    });

    it('names no instance path', () => {
      const hits = INSTANCE_PATHS.filter((re) => re.test(text)).map(String);
      expect(hits).toEqual([]);
    });

    it('links only through $JEEVES_SCRIPTS_DIR package paths (no relative links)', () => {
      const other = [...prose(text).matchAll(/\]\(([^)\s]+)\)/g)]
        .map(([, link = '']) => link)
        .filter((link) => !/^(https?|mailto):/.test(link))
        .filter((link) => !link.startsWith(PKG_PREFIX));
      expect(other).toEqual([]);
      expect(text).not.toContain('{scriptsDir}');
    });

    it('names only package paths that exist, with valid anchors', () => {
      const paths = [...text.matchAll(PKG_PATHS)].map(([, rest = '']) => rest);
      expect(paths.length).toBeGreaterThan(0);
      expect(paths.filter(brokenPackagePath)).toEqual([]);
    });
  });
});
