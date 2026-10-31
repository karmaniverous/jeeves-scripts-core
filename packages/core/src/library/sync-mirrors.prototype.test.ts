/**
 * Prototype parity (spec 2.9 Tests): the generalised mirror, configured as
 * the instance prototype was (`subdir: skills`, a `.system/` exclude,
 * `siteLinks` `/skill/{name}` to `{dir}/SKILL.md`), records the counts the
 * prototype recorded on its verified input: 1181 files, 2 links and
 * 1181 written on the first run (one rename), then nothing written,
 * touched or deleted on an unchanged second run. The input is a synthetic tree of the same shape and size
 * (`<author>/<skill>/SKILL.md` plus support files, contributor tooling
 * under `.system/`, two resolvable site links, one ambiguous and one
 * unknown), built in a temp dir and served from a local git repo.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { run } from '@karmaniverous/jeeves';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { libraryMirrorSchema } from '../config/library-schema.js';
import { makeRepo } from './lib/library.test-helper.js';
import { listFiles } from './lib/mirror.js';
import { syncMirrors } from './lib/sync-mirror.js';

const AUTHORS = 30;
const SKILLS = 575;
const author = (i: number) => `author-${String(i % AUTHORS).padStart(2, '0')}`;
/** Skill k's name: every name unique except two `shared` skills under different authors. */
const skillName = (k: number) => (k < 2 ? 'shared' : `skill-${String(k)}`);

/** 30 author.md + 575 x (SKILL.md, references/notes.md) + README.md = 1181. */
const tree = (): Record<string, string> => {
  const files: Record<string, string> = {
    'skills/README.md': '# Library\n',
    'skills/.system/submit/SKILL.md': '# tooling\n',
    'skills/.system/submit/check.py': 'print("x")\n',
  };
  for (let i = 0; i < AUTHORS; i++)
    files[`skills/${author(i)}/author.md`] = `# ${author(i)}\n`;
  for (let k = 0; k < SKILLS; k++) {
    const dir = `skills/${author(k)}/${skillName(k)}`;
    files[`${dir}/SKILL.md`] = `# ${skillName(k)}\n`;
    files[`${dir}/references/notes.md`] = `notes ${String(k)}\n`;
  }
  // Same author (skill-32 is under author-02), another author, ambiguous, unknown.
  files[`skills/${author(2)}/skill-2/SKILL.md`] =
    '[a](/skill/skill-32) [b](/skill/skill-3/#use) [c](/skill/shared) [d](/skill/nope)\n';
  return files;
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'library-parity-'));
const url = makeRepo(path.join(root, 'upstream'), tree());
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('library-sync-mirrors matches the prototype on the same input', () => {
  it('first run creates 1181 files by one rename with 2 links; an unchanged re-run writes nothing', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const mirror = libraryMirrorSchema.parse({
      id: 'skills',
      repo: 'acme/skills',
      subdir: 'skills',
      dest: 'library/skills',
      exclude: ['.system/'],
      siteLinks: { pattern: '/skill/{name}', target: '{dir}/SKILL.md' },
    });
    const settings = {
      live: true,
      stateDir: path.join(root, 'state'),
      contentDir: path.join(root, 'content'),
    };
    const lines: string[] = [];
    const deps = {
      run,
      cloneUrl: () => url,
      log: (l: string) => lines.push(l),
    };

    const first = syncMirrors([mirror], settings, deps);
    expect(first).toEqual([
      expect.objectContaining({
        files: 1181,
        links: 2,
        write: 1181,
        touch: 0,
        delete: 0,
        created: true,
      }),
    ]);
    expect(lines.filter((l) => l.includes('(single rename)'))).toHaveLength(1);
    const dest = path.join(root, 'content', 'library', 'skills');
    expect(listFiles(dest)).toHaveLength(1181);
    expect(
      fs.readFileSync(
        path.join(dest, author(2), 'skill-2', 'SKILL.md'),
        'utf8',
      ),
    ).toBe(
      `[a](../skill-32/SKILL.md) [b](../../${author(3)}/skill-3/SKILL.md#use) [c](/skill/shared) [d](/skill/nope)\n`,
    );

    const second = syncMirrors([mirror], settings, deps);
    expect(second).toEqual([
      expect.objectContaining({
        files: 1181,
        links: 2,
        write: 0,
        touch: 0,
        delete: 0,
        created: false,
      }),
    ]);
    vi.restoreAllMocks();
  }, 120_000);
});
