import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeOpenclaw } from './fake-openclaw.test-helper.js';
import type { RunCommand } from './openclaw.js';
import {
  installChange,
  runSkills,
  skillsDirFor,
  statusLines,
  uninstallChange,
} from './skills.js';

const root = path.resolve('/repo');
const dir = skillsDirFor(root);
const SKILLS = ['jeeves-email', 'jeeves-x'];
const envPath = (s: string) => `skills.entries.${s}.env.JEEVES_SCRIPTS_DIR`;

let lines: string[];
const log = (line: string) => lines.push(line);

beforeEach(() => {
  lines = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('install / uninstall changes', () => {
  it('install adds the folder and every env var, keeping other entries', () => {
    const change = installChange({
      root,
      skills: SKILLS,
      config: { load: { extraDirs: ['/other'] } },
    });
    expect(change).toEqual({
      sets: [
        { path: 'skills.load.extraDirs', value: ['/other', dir] },
        { path: envPath('jeeves-email'), value: root },
        { path: envPath('jeeves-x'), value: root },
      ],
      unsets: [],
    });
  });

  it('install is idempotent', () => {
    const config = {
      load: { extraDirs: [dir] },
      entries: {
        'jeeves-email': { env: { JEEVES_SCRIPTS_DIR: root } },
        'jeeves-x': { env: { JEEVES_SCRIPTS_DIR: root } },
      },
    };
    expect(installChange({ root, skills: SKILLS, config })).toEqual({
      sets: [],
      unsets: [],
    });
  });

  it("uninstall removes exactly this repo's entries", () => {
    const config = {
      load: { extraDirs: ['/other', dir] },
      entries: {
        'jeeves-email': { env: { JEEVES_SCRIPTS_DIR: root, KEEP: 'x' } },
        'jeeves-x': { env: { JEEVES_SCRIPTS_DIR: '/another-repo' } },
      },
    };
    expect(uninstallChange({ root, skills: SKILLS, config })).toEqual({
      sets: [{ path: 'skills.load.extraDirs', value: ['/other'] }],
      unsets: [envPath('jeeves-email')],
    });
    expect(
      uninstallChange({
        root,
        skills: [],
        config: { load: { extraDirs: [dir] } },
      }),
    ).toEqual({ sets: [], unsets: ['skills.load'] });
  });

  it('uninstall leaves no empty objects behind', () => {
    const config = {
      load: { extraDirs: [dir], watch: true },
      entries: {
        'jeeves-email': { env: { JEEVES_SCRIPTS_DIR: root }, enabled: true },
        'jeeves-x': { env: { JEEVES_SCRIPTS_DIR: root } },
        other: { env: { TOKEN: 'x' } },
      },
    };
    expect(uninstallChange({ root, skills: SKILLS, config })).toEqual({
      sets: [],
      unsets: [
        'skills.load.extraDirs',
        'skills.entries.jeeves-email.env',
        'skills.entries.jeeves-x',
      ],
    });
    const { other: _other, ...ours } = config.entries;
    expect(
      uninstallChange({
        root,
        skills: SKILLS,
        config: {
          entries: {
            ...ours,
            'jeeves-email': { env: { JEEVES_SCRIPTS_DIR: root } },
          },
        },
      }),
    ).toEqual({ sets: [], unsets: ['skills.entries'] });
  });
});

describe('statusLines', () => {
  it('reports wired, missing, stale and shadowed entries', () => {
    const staleDir = path.join(
      path.resolve('/old'),
      'node_modules/@karmaniverous/jeeves-scripts-core/skills',
    );
    const out = statusLines(
      {
        root,
        skills: [...SKILLS, 'jeeves-slack'],
        config: {
          load: { extraDirs: [staleDir] },
          entries: {
            'jeeves-email': { env: { JEEVES_SCRIPTS_DIR: root } },
            'jeeves-x': { env: { JEEVES_SCRIPTS_DIR: '/old' } },
          },
        },
      },
      new Map([
        ['jeeves-email', 'openclaw-extra'],
        ['jeeves-slack', 'openclaw-workspace'],
      ]),
    );
    expect(out).toEqual([
      `skills: ${dir}`,
      '  extraDirs: missing',
      `  extraDirs: stale (another core skills folder: ${staleDir})`,
      '  jeeves-email: wired',
      '  jeeves-x: stale (JEEVES_SCRIPTS_DIR="/old")',
      '  jeeves-slack: missing; shadowed by a openclaw-workspace skill',
    ]);
  });

  it('notes when skill sources are unavailable', () => {
    expect(
      statusLines({ root, skills: [], config: undefined }, new Error('nope')),
    ).toContain('  skill sources: unavailable (nope)');
  });
});

describe('runSkills', () => {
  it('install shows the change, asks, and applies it in one batch', async () => {
    const fake = fakeOpenclaw();
    const confirm = vi.fn(() => Promise.resolve(true));

    const code = await runSkills('install', {
      root,
      skills: SKILLS,
      run: fake.run,
      confirm,
      log,
    });

    expect(code).toBe(0);
    expect(confirm).toHaveBeenCalledOnce();
    expect(lines[0]).toBe("skills install: this changes OpenClaw's config:");
    expect(lines).toContain(
      `  set   ${envPath('jeeves-x')} = ${JSON.stringify(root)}`,
    );
    expect(lines.at(-1)).toBe('skills install: applied');
    expect(fake.config).toEqual({
      skills: {
        load: { extraDirs: [dir] },
        entries: {
          'jeeves-email': { env: { JEEVES_SCRIPTS_DIR: root } },
          'jeeves-x': { env: { JEEVES_SCRIPTS_DIR: root } },
        },
      },
    });
    expect(
      fake.calls.filter((c) => c[2] === 'set').map((c) => c.slice(0, 4)),
    ).toEqual([['openclaw', 'config', 'set', '--batch-file']]);
  });

  it('applies nothing when the answer is no, and prints the command', async () => {
    const fake = fakeOpenclaw();

    const code = await runSkills('install', {
      root,
      skills: SKILLS,
      run: fake.run,
      confirm: () => Promise.resolve(false),
      log,
    });

    expect(code).toBe(0);
    expect(fake.config).toEqual({});
    expect(lines.at(-1)).toBe(
      'Not applied. To apply: node bin/jeeves-scripts.js skills install --yes',
    );
  });

  it('--yes applies without asking; then uninstall restores the config', async () => {
    const fake = fakeOpenclaw({ skills: { load: { extraDirs: ['/keep'] } } });
    const confirm = vi.fn(() => Promise.resolve(false));
    const opts = {
      root,
      skills: SKILLS,
      run: fake.run,
      confirm,
      log,
      yes: true,
    };

    expect(await runSkills('install', opts)).toBe(0);
    expect(await runSkills('install', opts)).toBe(0);
    expect(lines.at(-1)).toBe('skills install: nothing to change');
    expect(await runSkills('uninstall', opts)).toBe(0);

    expect(confirm).not.toHaveBeenCalled();
    expect(fake.config).toEqual({
      skills: { load: { extraDirs: ['/keep'] } },
    });
  });

  it('status prints the report with skill sources', async () => {
    const fake = fakeOpenclaw({}, [
      { name: 'jeeves-email', source: 'openclaw-workspace' },
    ]);

    expect(
      await runSkills('status', { root, skills: SKILLS, run: fake.run, log }),
    ).toBe(0);

    expect(lines).toContain(
      '  jeeves-email: missing; shadowed by a openclaw-workspace skill',
    );
  });

  it('exits 1 when openclaw config set fails', async () => {
    const fake = fakeOpenclaw();
    const run: RunCommand = (command, args) =>
      args[1] === 'set'
        ? Promise.resolve({ code: 1, stdout: '', stderr: 'invalid config' })
        : fake.run(command, args);

    const code = await runSkills('install', {
      root,
      skills: SKILLS,
      run,
      yes: true,
      log,
      error: (line) => lines.push(`stderr: ${line}`),
    });

    expect(code).toBe(1);
    expect(lines.at(-1)).toMatch(/^stderr: /);
    expect(lines.at(-1)?.slice('stderr: '.length)).toMatch(
      /^skills install: FAILED: openclaw config set failed \(exit 1\): invalid config$/,
    );
  });

  it('exits 1 when openclaw is missing', async () => {
    const run: RunCommand = () =>
      Promise.reject(new Error('spawn openclaw ENOENT'));
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    expect(await runSkills('status', { root, skills: SKILLS, run, log })).toBe(
      1,
    );
    expect(lines).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      'skills status: FAILED: spawn openclaw ENOENT',
    );
  });
});
