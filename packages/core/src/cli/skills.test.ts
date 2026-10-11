import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildProgram } from './index.js';
import {
  type CommandResult,
  configSetBatch,
  openclawPresent,
  type RunCommand,
  runCommand,
} from './openclaw.js';
import {
  installChange,
  runSkills,
  shippedSkills,
  skillsDirFor,
  statusLines,
  uninstallChange,
} from './skills.js';

const root = path.resolve('/repo');
const dir = skillsDirFor(root);
const SKILLS = ['jeeves-email', 'jeeves-x'];
const envPath = (s: string) => `skills.entries.${s}.env.JEEVES_SCRIPTS_DIR`;

type Json = Record<string, unknown>;

const getPath = (obj: unknown, dotted: string): unknown =>
  dotted
    .split('.')
    .reduce<unknown>(
      (o, k) =>
        o !== null && typeof o === 'object' ? (o as Json)[k] : undefined,
      obj,
    );

const setPath = (obj: Json, dotted: string, value: unknown) => {
  const keys = dotted.split('.');
  const last = keys.pop() ?? '';
  let o = obj;
  for (const k of keys) {
    o[k] ??= {};
    o = o[k] as Json;
  }
  if (value === undefined) Reflect.deleteProperty(o, last);
  else o[last] = value;
};

/** An in-memory `openclaw`: config get/set --batch-file/unset, skills list. */
const fakeOpenclaw = (config: Json = {}, sources: Json[] = []) => {
  const calls: string[][] = [];
  const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '' });
  const run: RunCommand = (command, args) => {
    calls.push([command, ...args]);
    const [a, b, c] = args;
    if (a === '--version') return Promise.resolve(ok('OpenClaw 2026.9.6'));
    if (a === 'skills' && b === 'list')
      return Promise.resolve(
        ok(`banner\n${JSON.stringify({ skills: sources })}`),
      );
    if (a === 'config' && b === 'get') {
      const v = getPath(config, c ?? '');
      return Promise.resolve(
        v === undefined
          ? {
              code: 1,
              stdout: `{"ok":false,"error":{"message":"Config path is valid but unset: ${c ?? ''}."}}`,
              stderr: '',
            }
          : ok(JSON.stringify(v)),
      );
    }
    if (a === 'config' && b === 'set' && c === '--batch-file') {
      const ops = JSON.parse(fs.readFileSync(args[3] ?? '', 'utf8')) as {
        path: string;
        value: unknown;
      }[];
      for (const op of ops) setPath(config, op.path, op.value);
      return Promise.resolve(ok());
    }
    if (a === 'config' && b === 'unset') {
      setPath(config, c ?? '', undefined);
      return Promise.resolve(ok());
    }
    return Promise.resolve({ code: 2, stdout: '', stderr: 'unknown command' });
  };
  return { config, calls, run };
};

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
    ).toEqual({ sets: [], unsets: ['skills.load.extraDirs'] });
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
      skills: {
        load: { extraDirs: ['/keep'] },
        entries: { 'jeeves-email': { env: {} }, 'jeeves-x': { env: {} } },
      },
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
    });

    expect(code).toBe(1);
    expect(lines.at(-1)).toMatch(
      /^skills install: FAILED: openclaw config set failed \(exit 1\): invalid config$/,
    );
  });

  it('exits 1 when openclaw is missing', async () => {
    const run: RunCommand = () =>
      Promise.reject(new Error('spawn openclaw ENOENT'));
    expect(await runSkills('status', { root, skills: SKILLS, run, log })).toBe(
      1,
    );
    expect(lines).toEqual(['skills status: FAILED: spawn openclaw ENOENT']);
  });
});

describe('openclaw helpers', () => {
  it('openclawPresent is false when it cannot start or fails', async () => {
    expect(
      await openclawPresent(() => Promise.reject(new Error('ENOENT'))),
    ).toBe(false);
    expect(
      await openclawPresent(() =>
        Promise.resolve({ code: 1, stdout: '', stderr: '' }),
      ),
    ).toBe(false);
    expect(await openclawPresent(fakeOpenclaw().run)).toBe(true);
  });

  it('configSetBatch does nothing for no sets', async () => {
    const fake = fakeOpenclaw();
    await configSetBatch([], fake.run);
    expect(fake.calls).toEqual([]);
  });

  it('runCommand captures output and exit code, and rejects when it cannot start', async () => {
    const r = await runCommand(process.execPath, [
      '-e',
      'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)',
    ]);
    expect(r).toEqual({ code: 3, stdout: 'out', stderr: 'err' });
    await expect(
      runCommand('jeeves-scripts-no-such-command', []),
    ).rejects.toThrow();
  });
});

describe('skills command', () => {
  let tmp: string;
  const savedPath = process.env.PATH;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-skills-'));
  });

  afterEach(() => {
    process.env.PATH = savedPath;
    Reflect.deleteProperty(process.env, 'FAKE_OPENCLAW_STATE');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('runs install --yes against a fake openclaw executable on PATH', async () => {
    // A fake `openclaw` that keeps its config in a JSON file.
    const state = path.join(tmp, 'state.json');
    fs.writeFileSync(state, '{}');
    fs.writeFileSync(
      path.join(tmp, 'fake-openclaw.mjs'),
      `import fs from 'node:fs';
const file = process.env.FAKE_OPENCLAW_STATE;
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
const [a, b, c, d] = process.argv.slice(2);
const get = (p) => p.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), config);
const set = (p, v) => { const ks = p.split('.'); const last = ks.pop(); let o = config; for (const k of ks) o = o[k] ??= {}; if (v === undefined) delete o[last]; else o[last] = v; };
if (a === 'config' && b === 'get') { const v = get(c); if (v === undefined) { console.log('{"error":{"message":"Config path is valid but unset"}}'); process.exit(1); } console.log(JSON.stringify(v)); }
else if (a === 'config' && b === 'set' && c === '--batch-file') { for (const op of JSON.parse(fs.readFileSync(d, 'utf8'))) set(op.path, op.value); }
else if (a === 'config' && b === 'unset') set(c, undefined);
else process.exit(2);
fs.writeFileSync(file, JSON.stringify(config));
`,
    );
    const script = path.join(tmp, 'fake-openclaw.mjs');
    if (process.platform === 'win32')
      fs.writeFileSync(
        path.join(tmp, 'openclaw.cmd'),
        `@"${process.execPath}" "${script}" %*\r\n`,
      );
    else {
      fs.writeFileSync(
        path.join(tmp, 'openclaw'),
        `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`,
      );
      fs.chmodSync(path.join(tmp, 'openclaw'), 0o755);
    }
    process.env.PATH = `${tmp}${path.delimiter}${savedPath ?? ''}`;
    process.env.FAKE_OPENCLAW_STATE = state;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const repo = path.join(tmp, 'repo');

    await buildProgram({ root: repo }).parseAsync(
      ['skills', 'install', '--yes'],
      {
        from: 'user',
      },
    );

    expect(process.exitCode).toBeUndefined();
    const written = JSON.parse(fs.readFileSync(state, 'utf8')) as unknown;
    expect(getPath(written, 'skills.load.extraDirs')).toEqual([
      skillsDirFor(repo),
    ]);
    for (const skill of shippedSkills())
      expect(
        getPath(written, `skills.entries.${skill}.env.JEEVES_SCRIPTS_DIR`),
      ).toBe(repo);
  });
});
