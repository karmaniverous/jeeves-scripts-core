import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
      { id: 'local-job', script: 'src/vc/local.ts' },
      { id: 'missing-job', script: 'src/nowhere/gone.ts' },
      { name: 'not a job' },
    ]),
  );
  write(path.join(root, 'jobs', 'notes.txt'), 'ignored');
  write(path.join(root, 'src', 'vc', 'local.ts'), 'export {};\n');
  write(
    path.join(dist, 'email', 'poll.js'),
    'globalThis.__jscRunArgv = process.argv.slice(2);\n',
  );
});

afterEach(() => {
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
});

describe('readJobs', () => {
  it('reads every job object from jobs/*.json, skipping non-jobs', () => {
    expect(readJobs(root).map((j) => j.id)).toEqual([
      'core-job',
      'local-job',
      'missing-job',
    ]);
  });

  it('returns no jobs when jobs/ is missing', () => {
    expect(readJobs(path.join(root, 'nope'))).toEqual([]);
  });
});

describe('resolveJob', () => {
  it('prefers the instance script at the job path', () => {
    const r = resolveJob(root, 'local-job', dist);
    expect(r.kind).toBe('instance');
    expect(r.file).toBe(path.join(root, 'src', 'vc', 'local.ts'));
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
