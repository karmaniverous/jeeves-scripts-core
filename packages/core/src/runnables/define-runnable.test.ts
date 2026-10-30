import { afterEach, describe, expect, it, vi } from 'vitest';

import { argFlag, argValue } from '../lib/args.js';
import {
  defineRunnable,
  isJobModule,
  type RunJobDeps,
  runJobModule,
} from './define-runnable.js';
import * as deprecated from './deprecated.js';

const savedArgv = process.argv;
afterEach(() => {
  process.argv = savedArgv;
});

/** Deps that run the body synchronously and record the runScript call. */
const fakeDeps = () => {
  const calls: { name: string; crashDir: string | undefined }[] = [];
  const log = vi.fn<(line: string) => void>();
  const deps: RunJobDeps = {
    runScript: (name, fn, crashDir) => {
      calls.push({ name, crashDir });
      void fn();
    },
    log,
  };
  return { calls, log, deps };
};

describe('defineJob (deprecated alias)', () => {
  it('is defineRunnable, so instance plugins written against 0.2 keep working', () => {
    // Read by name: the deprecated symbol is never referenced directly in core.
    expect(deprecated).toHaveProperty('defineJob', defineRunnable);
  });
});

describe('defineRunnable', () => {
  it('returns the declaration frozen and marked as a job, running nothing', () => {
    const run = vi.fn();
    const job = defineRunnable({ id: 'acme-report', domain: 'acme', run });
    expect(isJobModule(job)).toBe(true);
    expect(Object.isFrozen(job)).toBe(true);
    expect(job).toMatchObject({ id: 'acme-report', domain: 'acme' });
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps a one-line description for list', () => {
    const job = defineRunnable({
      id: 'google-drive-report',
      domain: 'google-drive',
      description: 'Report on the drive.',
      run: () => undefined,
    });
    expect(job.description).toBe('Report on the drive.');
  });

  it.each([
    ['an id with capitals', { id: 'Acme', domain: 'acme' }, /runnable id/],
    [
      'an id with a trailing dash',
      { id: 'acme-', domain: 'acme' },
      /runnable id/,
    ],
    ['an empty domain', { id: 'acme', domain: '' }, /domain/],
    [
      'an id that does not start with its domain',
      { id: 'report-acme', domain: 'acme' },
      /must start with its domain and a dash/,
    ],
    [
      'an id that is only its domain',
      { id: 'acme', domain: 'acme' },
      /must start with its domain and a dash/,
    ],
    [
      'an empty description',
      { id: 'acme-report', domain: 'acme', description: '' },
      /description/,
    ],
  ])('rejects %s', (_label, fields, message) => {
    expect(() => defineRunnable({ ...fields, run: () => undefined })).toThrow(
      message,
    );
  });

  it('rejects a declaration without a run function', () => {
    expect(() =>
      defineRunnable({ id: 'acme', domain: 'acme', run: 'nope' } as never),
    ).toThrow(/run must be a function/);
  });

  it('tells jobs from other values', () => {
    expect(isJobModule({ id: 'acme', domain: 'acme', run: () => 0 })).toBe(
      false,
    );
    expect(isJobModule(null)).toBe(false);
    expect(isJobModule('acme')).toBe(false);
  });
});

describe('runJobModule', () => {
  it('parses flags itself when a caller passes only args', async () => {
    const run = vi.fn();
    const job = defineRunnable({
      id: 'acme-direct',
      domain: 'acme',
      flags: { live: argFlag('--live') },
      run,
    });
    await job.run({ args: ['--live'] });
    expect(run).toHaveBeenCalledWith({
      args: ['--live'],
      flags: { live: true },
    });
  });

  it('parses declared flags into ctx.flags (#14)', async () => {
    const run = vi.fn();
    const job = defineRunnable({
      id: 'acme-flags',
      domain: 'acme',
      flags: { live: argFlag('--live'), max: argValue('--max', '5') },
      run,
    });
    await runJobModule(job, ['--live', '--max=3'], fakeDeps().deps);
    expect(run).toHaveBeenCalledWith({
      args: ['--live', '--max=3'],
      flags: { live: true, max: '3' },
    });
  });

  it('sets argv to [node, id, ...args] and passes the args to run', async () => {
    const run = vi.fn();
    const { deps } = fakeDeps();
    await runJobModule(
      defineRunnable({ id: 'acme-report', domain: 'acme', run }),
      ['--live', 'x'],
      deps,
    );
    expect(process.argv.slice(1)).toEqual(['acme-report', '--live', 'x']);
    expect(run).toHaveBeenCalledWith({ args: ['--live', 'x'], flags: {} });
  });

  it('wraps the run in runScript under the job name, or the id, with its crash dir', async () => {
    const { calls, deps } = fakeDeps();
    await runJobModule(
      defineRunnable({
        id: 'acme-report',
        domain: 'acme',
        name: 'acme/report',
        crashDir: () => '/base/acme',
        run: () => undefined,
      }),
      [],
      deps,
    );
    await runJobModule(
      defineRunnable({
        id: 'acme-other',
        domain: 'acme',
        run: () => undefined,
      }),
      [],
      deps,
    );
    expect(calls).toEqual([
      { name: 'acme/report', crashDir: '/base/acme' },
      { name: 'acme-other', crashDir: undefined },
    ]);
  });

  it('resolves only after an async run has finished', async () => {
    const order: string[] = [];
    const { deps } = fakeDeps();
    await runJobModule(
      defineRunnable({
        id: 'acme-slow',
        domain: 'acme',
        run: async () => {
          await new Promise((r) => setTimeout(r, 5));
          order.push('ran');
        },
      }),
      [],
      deps,
    );
    order.push('resolved');
    expect(order).toEqual(['ran', 'resolved']);
  });

  it('skips the run with a [skip] line when the prerequisite is not met', async () => {
    const run = vi.fn();
    const { deps, log } = fakeDeps();
    await runJobModule(
      defineRunnable({
        id: 'acme-report',
        domain: 'acme',
        prerequisite: () => 'no acme block in jeeves-scripts.json',
        run,
      }),
      [],
      deps,
    );
    expect(run).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      '[skip] no acme block in jeeves-scripts.json',
    );
  });

  it('runs when an async prerequisite is met', async () => {
    const run = vi.fn();
    const { deps, log } = fakeDeps();
    await runJobModule(
      defineRunnable({
        id: 'acme-report',
        domain: 'acme',
        prerequisite: () => Promise.resolve(true as const),
        run,
      }),
      [],
      deps,
    );
    expect(run).toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
