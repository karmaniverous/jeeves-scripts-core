import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  findRepo,
  handOff,
  LAUNCHER,
  locate,
  runLauncher,
  splitDir,
} from './hand-off.js';
import { buildProgram } from './index.js';
import { coreVersion } from './package-info.js';

let tmp: string;
let repo: string;

const makeRepo = (dir: string, launcher = true) => {
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'jeeves-scripts.json'), '{}');
  if (launcher)
    fs.writeFileSync(
      path.join(dir, LAUNCHER),
      'process.exitCode = Number(process.argv[2] ?? 0);\n',
    );
};

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-hand-')));
  repo = path.join(tmp, 'repo');
  makeRepo(repo);
  fs.mkdirSync(path.join(repo, 'src', 'deep'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'elsewhere'));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('splitDir', () => {
  it('takes only a leading --dir', () => {
    expect(splitDir(['--dir', '/r', 'run', 'x'])).toEqual({
      dir: '/r',
      args: ['run', 'x'],
    });
    expect(splitDir(['--dir=/r', 'list'])).toEqual({
      dir: '/r',
      args: ['list'],
    });
    expect(splitDir(['run', 'x', '--dir', '/r'])).toEqual({
      args: ['run', 'x', '--dir', '/r'],
    });
  });

  it.each([[['--dir']], [['--dir=']]])(
    'rejects --dir without a path: %j',
    (args) => {
      expect(() => splitDir(args)).toThrow('--dir needs a path');
    },
  );
});

describe('locate', () => {
  it('prefers --dir, then JEEVES_SCRIPTS_DIR, then walking up', () => {
    const other = path.join(tmp, 'other');
    makeRepo(other);
    const deep = path.join(repo, 'src', 'deep');

    expect(
      locate(['--dir', other, 'list'], { JEEVES_SCRIPTS_DIR: repo }, deep),
    ).toEqual({
      launcher: path.join(other, LAUNCHER),
      root: other,
      args: ['list'],
    });
    expect(locate(['list'], { JEEVES_SCRIPTS_DIR: other }, deep).launcher).toBe(
      path.join(other, LAUNCHER),
    );
    expect(locate(['list'], {}, deep)).toEqual({
      launcher: path.join(repo, LAUNCHER),
      root: repo,
      args: ['list'],
    });
  });

  it('resolves a relative --dir from the working directory', () => {
    expect(locate(['--dir', 'repo'], {}, tmp).launcher).toBe(
      path.join(repo, LAUNCHER),
    );
  });

  it('finds no launcher outside a repo, or in a repo without one yet', () => {
    const elsewhere = path.join(tmp, 'elsewhere');
    expect(findRepo(elsewhere)).toBeUndefined();
    expect(locate(['init'], {}, elsewhere)).toEqual({
      root: elsewhere,
      args: ['init'],
    });
    const fresh = path.join(tmp, 'fresh');
    makeRepo(fresh, false);
    expect(locate(['init'], {}, fresh)).toEqual({
      root: fresh,
      args: ['init'],
    });
    expect(locate(['--dir', path.join(tmp, 'new'), 'init'], {}, tmp)).toEqual({
      root: path.join(tmp, 'new'),
      args: ['init'],
    });
  });
});

describe('handOff', () => {
  it("delegates to the repo's launcher with the rest of the command line", async () => {
    const delegate = vi.fn(() => Promise.resolve(3));
    const code = await handOff(['--dir', repo, 'run', 'x', '--dir', 'y'], {
      env: {},
      delegate,
    });
    expect(code).toBe(3);
    expect(delegate).toHaveBeenCalledWith(path.join(repo, LAUNCHER), [
      'run',
      'x',
      '--dir',
      'y',
    ]);
  });

  it.each([[['init', '--name', 'a']], [['--help']], [['--version']], [[]]])(
    'runs %j itself without a repo',
    async (args) => {
      const run = vi.fn(() => Promise.resolve(0));
      const elsewhere = path.join(tmp, 'elsewhere');
      expect(await handOff(args, { env: {}, cwd: elsewhere, run })).toBe(0);
      expect(run).toHaveBeenCalledWith(elsewhere, args);
    },
  );

  it('exits 1 without a repo for anything else, saying how to point at one', async () => {
    const error = vi.fn();
    const run = vi.fn(() => Promise.resolve(0));
    const code = await handOff(['run', 'x'], {
      env: {},
      cwd: path.join(tmp, 'elsewhere'),
      run,
      error,
    });
    expect(code).toBe(1);
    expect(run).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(
        /no scripts repo found.*--dir <path>.*JEEVES_SCRIPTS_DIR/,
      ),
    );
  });

  it('exits 1 on --dir without a path', async () => {
    const error = vi.fn();
    expect(await handOff(['--dir'], { env: {}, error })).toBe(1);
    expect(error).toHaveBeenCalledWith(
      'jeeves-scripts: --dir needs a path: --dir <path>',
    );
  });

  it('runs init without a repo through the real CLI', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const target = path.join(tmp, 'elsewhere');
    const code = await handOff(['init', '--core', 'not-a-version'], {
      env: {},
      cwd: target,
    });
    expect(code).toBe(1);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^init: FAILED/));
    process.exitCode = undefined;
  });
});

describe('runLauncher', () => {
  it('runs the launcher with node and resolves to its exit code', async () => {
    expect(await runLauncher(path.join(repo, LAUNCHER), ['4'])).toBe(4);
    expect(await runLauncher(path.join(repo, LAUNCHER), [])).toBe(0);
  });
});

describe('--version', () => {
  it('prints the core version', async () => {
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const program = buildProgram({ root: tmp }).exitOverride();
    await expect(
      program.parseAsync(['--version'], { from: 'user' }),
    ).rejects.toThrow();
    expect(write).toHaveBeenCalledWith(`${coreVersion()}\n`);
  });
});
