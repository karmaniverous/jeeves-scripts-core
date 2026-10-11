import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnSync = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => { status: number | null }>(),
);
vi.mock('node:child_process', () => ({ spawnSync }));

import { CONFIG_PATH_ENV } from '../config/loader.js';
import { defineJob } from '../jobs/define-job.js';
import type { RegistryEntry } from '../jobs/registry.js';
import { readJobs, resolveJob, runJob } from './run.js';

let root: string;
const ran: { id: string; args: readonly string[]; argv: string[] }[] = [];

const write = (file: string, content: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

const entry = (id: string, module: string): RegistryEntry => ({
  id,
  domain: module.split('/')[0] ?? '',
  module,
  load: () =>
    Promise.resolve({
      default: defineJob({
        id,
        domain: module.split('/')[0] ?? '',
        run: ({ args }) => {
          ran.push({ id, args, argv: process.argv.slice(1) });
        },
      }),
    }),
});

/** A test registry: two core jobs. */
const registry: RegistryEntry[] = [
  entry('email-poll', 'email/poll'),
  entry('slack-poll', 'slack/poll'),
];

beforeEach(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-run-'));
  root = path.join(tmp, 'instance');
  write(
    path.join(root, 'jobs', 'a.json'),
    JSON.stringify([
      { id: 'poll-email', script: 'src/email/poll.ts' },
      { id: 'local-job', script: 'src/acme/local.ts' },
      { id: 'missing-job', script: 'src/nowhere/gone.ts', enabled: false },
      { id: 'slack-poll', script: 'src/slack/poll.ts' },
    ]),
  );
  write(path.join(root, 'jobs', 'notes.txt'), 'ignored');
  write(path.join(root, 'src', 'acme', 'local.ts'), 'export {};\n');
  ran.length = 0;
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
      'poll-email',
      'local-job',
      'missing-job',
      'slack-poll',
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
  it('resolves a core id through the registry', () => {
    const r = resolveJob(root, 'email-poll', registry);
    expect(r).toMatchObject({ kind: 'core', entry: { id: 'email-poll' } });
  });

  it('resolves a core id through the registry even with no jobs/ dir', () => {
    const r = resolveJob(path.join(root, 'nope'), 'slack-poll', registry);
    expect(r).toMatchObject({ kind: 'core', entry: { id: 'slack-poll' } });
  });

  it('ignores an instance entry for a core id when the instance has no file there', () => {
    const r = resolveJob(root, 'slack-poll', registry);
    expect(r).toMatchObject({ kind: 'core', entry: { id: 'slack-poll' } });
  });

  it('never lets an instance file replace a core job (no silent override)', () => {
    write(path.join(root, 'src', 'slack', 'poll.ts'), 'export {};\n');
    expect(() => resolveJob(root, 'slack-poll', registry)).toThrow(
      /"slack-poll" is a core job; the instance file src\/slack\/poll\.ts would replace it/,
    );
  });

  it('runs the instance file for an instance-declared job', () => {
    const r = resolveJob(root, 'local-job', registry);
    expect(r).toEqual({
      kind: 'instance',
      job: { id: 'local-job', script: 'src/acme/local.ts' },
      file: path.join(root, 'src', 'acme', 'local.ts'),
    });
  });

  it('runs the instance file for an instance-declared id even at a core module path', () => {
    write(path.join(root, 'src', 'email', 'poll.ts'), 'export {};\n');
    const r = resolveJob(root, 'poll-email', registry);
    expect(r).toMatchObject({
      kind: 'instance',
      file: path.join(root, 'src', 'email', 'poll.ts'),
    });
  });

  it('aliases an instance id whose script names a core module to that core job', () => {
    const r = resolveJob(root, 'poll-email', registry);
    expect(r).toMatchObject({
      kind: 'core',
      entry: { id: 'email-poll' },
      alias: { id: 'poll-email' },
    });
  });

  it('throws on an unknown job id', () => {
    expect(() => resolveJob(root, 'nope', registry)).toThrow(
      /Unknown job "nope": not a core job and not declared/,
    );
  });

  it('throws when an instance job script exists nowhere', () => {
    expect(() => resolveJob(root, 'missing-job', registry)).toThrow(
      /neither in the instance repo nor a core job module/,
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

    expect(await runJob(root, 'local-job', ['--live'], registry)).toBe(3);

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

    expect(await runJob(root, 'local-job', [], registry)).toBe(1);
    expect(process.env[CONFIG_PATH_ENV]).toBe('/explicit/config.json');
  });

  it('runs a core job in process with its args, and argv set to [node, id, ...args]', async () => {
    const savedArgv = process.argv;
    try {
      expect(await runJob(root, 'email-poll', ['--dry-run'], registry)).toBe(0);
      expect(ran).toEqual([
        {
          id: 'email-poll',
          args: ['--dry-run'],
          argv: ['email-poll', '--dry-run'],
        },
      ]);
      expect(spawnSync).not.toHaveBeenCalled();
    } finally {
      process.argv = savedArgv;
    }
  });

  it('runs the aliased core job for an instance id naming a core module', async () => {
    const savedArgv = process.argv;
    try {
      await runJob(root, 'poll-email', [], registry);
      expect(ran.map((r) => r.id)).toEqual(['email-poll']);
    } finally {
      process.argv = savedArgv;
    }
  });

  it('fails on an unknown job before running anything', async () => {
    await expect(runJob(root, 'nope', [], registry)).rejects.toThrow(
      /Unknown job "nope"/,
    );
    expect(ran).toEqual([]);
    expect(spawnSync).not.toHaveBeenCalled();
  });
});
