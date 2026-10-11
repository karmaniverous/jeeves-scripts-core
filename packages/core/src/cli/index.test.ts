import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONFIG_PATH_ENV, resetConfig } from '../config/loader.js';
import { buildProgram, errorLine, main, resolveRoot } from './index.js';
import type * as PackageInfo from './package-info.js';

// These tests stub fs.readFileSync, which the --version option would read.
vi.mock('./package-info.js', async (importOriginal) => ({
  ...(await importOriginal<typeof PackageInfo>()),
  coreVersion: () => '9.9.9',
}));

const root = path.resolve('/instance');

const readFile = fs.readFileSync.bind(fs);

/**
 * Stub reading the instance's config file only: core's manifests (which
 * `config check` registers, Decision 57) are still read from disk.
 */
const stubConfig = (json: unknown) =>
  vi
    .spyOn(fs, 'readFileSync')
    .mockImplementation(((file: fs.PathOrFileDescriptor, ...rest: unknown[]) =>
      String(file).endsWith('.json') &&
      !String(file).includes(`${path.sep}jobs${path.sep}`) &&
      !String(file).includes('/jobs/')
        ? JSON.stringify(json)
        : (readFile as (...a: unknown[]) => unknown)(
            file,
            ...rest,
          )) as typeof fs.readFileSync);

describe('jeeves-scripts CLI', () => {
  // test/setup.ts points JEEVES_SCRIPTS_CONFIG at a shared test config;
  // these tests exercise root/--config resolution, so unset it here.
  const savedEnv = process.env[CONFIG_PATH_ENV];

  beforeEach(() => {
    Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
    resetConfig();
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env[CONFIG_PATH_ENV] = savedEnv;
    resetConfig();
    process.exitCode = undefined;
  });

  it('config check prints OK for a valid config under the root', async () => {
    const read = stubConfig({ instance: { name: 'test', baseDir: '/base' } });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await buildProgram({ root }).parseAsync(['config', 'check'], {
      from: 'user',
    });

    expect(read).toHaveBeenCalledWith(
      path.join(root, 'jeeves-scripts.json'),
      'utf8',
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('config check: OK'),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('config check --config prints FAILED and sets exit code 1', async () => {
    const read = vi
      .spyOn(fs, 'readFileSync')
      .mockReturnValue(JSON.stringify({ instance: { name: 'test' } }));
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await buildProgram({ root }).parseAsync(
      ['config', 'check', '--config', '/elsewhere/c.json'],
      { from: 'user' },
    );

    expect(read).toHaveBeenCalledWith('/elsewhere/c.json', 'utf8');
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('config check: FAILED'),
    );
    expect(process.exitCode).toBe(1);
  });

  it('main accepts a file URL root, as the launcher passes it, and returns the exit code', async () => {
    stubConfig({ instance: { name: 'test', baseDir: '/base' } });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await main({
      root: pathToFileURL(root + path.sep),
      argv: ['node', 'jeeves-scripts', 'config', 'check'],
    });

    expect(code).toBe(0);
  });

  describe('handled failures resolve to 1 with one stderr line', () => {
    let dir: string;

    const write = (file: string, value: unknown) => {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), JSON.stringify(value), 'utf8');
    };

    const runMain = async (...args: string[]) => {
      const errors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
        errors.push(String(line));
      });
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const code = await main({
        root: dir,
        argv: ['node', 'jeeves-scripts', ...args],
      });
      return { code, errors };
    };

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-main-'));
      write('jeeves-scripts.json', {
        instance: { name: 'test', baseDir: '/base' },
      });
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    const expectOneLine = (errors: string[], prefix: string) => {
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(new RegExp(`^${prefix}: FAILED: `));
      expect(errors[0]).not.toContain('\n');
      expect(errors[0]).not.toMatch(/\bat .*[\\/]src[\\/]/);
    };

    it('run with an unknown id', async () => {
      const { code, errors } = await runMain('run', 'nope-nothing');
      expect(code).toBe(1);
      expectOneLine(errors, 'run');
      expect(errors[0]).toContain('Unknown runnable "nope-nothing"');
    });

    it('run with an invalid plugin', async () => {
      fs.writeFileSync(
        path.join(dir, 'jeeves-scripts.plugin.ts'),
        'export default 42;\n',
        'utf8',
      );
      const { code, errors } = await runMain('run', 'email-poll');
      expect(code).toBe(1);
      expectOneLine(errors, 'run');
      expect(errors[0]).toContain('must default-export definePlugin');
    });

    it('list with an invalid instance manifest', async () => {
      write('jobs/local.json', { 'local-thing': { name: 'x' } });
      const { code, errors } = await runMain('list');
      expect(code).toBe(1);
      expectOneLine(errors, 'list');
    });

    it('list with a delta naming an unknown id', async () => {
      write('jeeves-scripts.json', {
        instance: { name: 'test', baseDir: '/base' },
        jobs: { 'nope-nothing': { enabled: false } },
      });
      const { code, errors } = await runMain('list');
      expect(code).toBe(1);
      expectOneLine(errors, 'list');
      expect(errors[0]).toContain('nope-nothing');
    });
  });

  it('errorLine joins a multi-line message and drops the stack', () => {
    expect(errorLine(new Error('first\n  second'))).toBe('first second');
    expect(errorLine('plain')).toBe('plain');
  });

  it('has no domain command groups (Decision 49)', () => {
    const verbs = buildProgram({ root }).commands.map((c) => c.name());
    expect(verbs).not.toContain('people');
    expect(verbs).not.toContain('email');
  });

  it('resolveRoot passes paths through and converts file URLs', () => {
    expect(resolveRoot(root)).toBe(root);
    expect(resolveRoot(pathToFileURL(root))).toBe(root);
  });
});
