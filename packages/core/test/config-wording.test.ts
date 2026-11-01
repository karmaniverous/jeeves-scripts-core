/**
 * The config lives outside the repo (#57): `jeeves-scripts.json` is only
 * the repo's pointer to it. So no shipped manifest prerequisite, and not
 * the `config check` help, tells an operator to put settings in
 * `jeeves-scripts.json`; they say the instance config.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildProgram } from '../src/cli/index.js';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jobsDir = path.join(pkg, 'jobs');

/** Every shipped manifest's prerequisite, as `file:id`. */
const prerequisites = (): [string, string][] =>
  fs
    .readdirSync(jobsDir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) =>
      Object.entries(
        JSON.parse(fs.readFileSync(path.join(jobsDir, f), 'utf8')) as Record<
          string,
          { prerequisite?: string | null }
        >,
      ).flatMap(([id, j]): [string, string][] =>
        typeof j.prerequisite !== 'string'
          ? []
          : [[`${f}:${id}`, j.prerequisite]],
      ),
    );

describe('config wording after the config moved out of the repo', () => {
  it('no manifest prerequisite names jeeves-scripts.json as the config', () => {
    const all = prerequisites();
    expect(all.length).toBeGreaterThan(10);
    expect(
      all
        .filter(([, p]) => p.includes('jeeves-scripts.json'))
        .map(([id]) => id),
    ).toEqual([]);
    expect(
      all
        .filter(([, p]) => p.includes('in the instance config'))
        .map(([id]) => id),
    ).toHaveLength(12);
  });

  it('config check help says it validates the instance config', () => {
    const config = buildProgram({ root: pkg }).commands.find(
      (c) => c.name() === 'config',
    );
    const check = config?.commands.find((c) => c.name() === 'check');
    expect(check?.description()).toMatch(
      /^Validate the instance config against the core schema/,
    );
    expect(check?.description()).not.toContain('jeeves-scripts.json');
  });
});
