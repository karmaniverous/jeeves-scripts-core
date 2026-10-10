import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnSync = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => { status: number | null }>(),
);
vi.mock('node:child_process', () => ({ spawnSync }));

import { CONFIG_PATH_ENV } from '../config/loader.js';
import { readJobs, resolveJob, runJob } from './run.js';

let root: string;
let dist: string;

const write = (file: string, content: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

beforeEach(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-run-'));
  root = path.join(tmp, 'instance');
  dist = path.join(tmp, 'dist');
  write(
    path.join(root, 'jobs', 'a.json'),
    JSON.stringify([
      { id: 'core-job', script: 'src/email/poll.ts' },
      { id: 'local-job', script: 'src/acme/local.ts' },
      { id: 'missing-job', script: 'src/nowhere/gone.ts', enabled: false },
    ]),
  );
  write(path.join(root, 'jobs', 'notes.txt'), 'ignored');
  write(path.join(root, 'src', 'acme', 'local.ts'), 'export {};\n');
  write(
    path.join(dist, 'email', 'poll.js'),
    'globalThis.__jscRunArgv = process.argv.slice(2);\n',
  );
});

afterEach(() => {
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
});

describe('readJobs', () => {
  it('reads every job from jobs/*.json in file order, keeping runner fields', () => {
    write(
      path.join(root, 'jobs', '0-first.json'),
      JSON.stringify([{ id: 'first', script: 'src/a/b.ts' }]),
    );
    const jobs = readJobs(root);
    expect(jobs.map((j) => j.id)).toEqual([
      'first',
      'core-job',
      'local-job',
      'missing-job',
    ]);
    expect(jobs[3]).toMatchObject({ enabled: false });
  });

  it.each([
    [
      'an entry without a script',
      [{ id: 'x' }],
      /jobs\/bad\.json[\s\S]*script/,
    ],
    [
      'an entry with an empty id',
      [{ id: '', script: 's.ts' }],
      /jobs\/bad\.json[\s\S]*id/,
    ],
    ['a non-array file', { id: 'x', script: 's.ts' }, /jobs\/bad\.json/],
  ])('fails on %s, naming the file', (_label, content, message) => {
    write(path.join(root, 'jobs', 'bad.json'), JSON.stringify(content));
    expect(() => readJobs(root)).toThrow(message);
  });

  it('returns no jobs when jobs/ is missing', () => {
    expect(readJobs(path.join(root, 'nope'))).toEqual([]);
  });
});

describe('resolveJob', () => {
  it('prefers the instance script at the job path', () => {
    const r = resolveJob(root, 'local-job', dist);
    expect(r.kind).toBe('instance');
    expect(r.file).toBe(path.join(root, 'src', 'acme', 'local.ts'));
  });

  it("falls back to core's built module for the same path", () => {
    const r = resolveJob(root, 'core-job', dist);
    expect(r.kind).toBe('core');
    expect(r.file).toBe(path.join(dist, 'email', 'poll.js'));
  });

  it('throws on an unknown job id', () => {
    expect(() => resolveJob(root, 'nope', dist)).toThrow(/Unknown job "nope"/);
  });

  it('throws when neither the instance nor core has the script', () => {
    expect(() => resolveJob(root, 'missing-job', dist)).toThrow(
      /neither in the instance repo nor in core/,
    );
  });
});

describe('runJob', () => {
  const savedConfig = process.env[CONFIG_PATH_ENV];
  afterEach(() => {
    process.env[CONFIG_PATH_ENV] = savedConfig;
    spawnSync.mockReset();
  });

  it('runs an instance script in a child tsx process and returns its exit code', async () => {
    Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
    spawnSync.mockReturnValue({ status: 3 });

    expect(await runJob(root, 'local-job', ['--live'], dist)).toBe(3);

    const file = path.join(root, 'src', 'acme', 'local.ts');
    expect(spawnSync).toHaveBeenCalledWith(
      process.execPath,
      ['--import', 'tsx', file, '--live'],
      expect.objectContaining({ cwd: root, stdio: 'inherit' }),
    );
    expect(process.env[CONFIG_PATH_ENV]).toBe(
      path.join(root, 'jeeves-scripts.json'),
    );
  });

  it('keeps an explicit JEEVES_SCRIPTS_CONFIG and maps a killed child to exit 1', async () => {
    process.env[CONFIG_PATH_ENV] = '/explicit/config.json';
    spawnSync.mockReturnValue({ status: null });

    expect(await runJob(root, 'local-job', [], dist)).toBe(1);
    expect(process.env[CONFIG_PATH_ENV]).toBe('/explicit/config.json');
  });

  it('imports a core module with the job args as process.argv', async () => {
    const savedArgv = process.argv;
    try {
      expect(await runJob(root, 'core-job', ['--dry-run'], dist)).toBe(0);
      expect((globalThis as { __jscRunArgv?: string[] }).__jscRunArgv).toEqual([
        '--dry-run',
      ]);
    } finally {
      process.argv = savedArgv;
    }
  });
});
