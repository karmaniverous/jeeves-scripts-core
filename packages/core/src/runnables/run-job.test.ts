import { argFlag, argValue } from '@karmaniverous/jeeves';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defineRunnable } from './define-runnable.js';
import { type RunJobDeps, runJobModule } from './run-job.js';

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
      jobId: 'acme-direct',
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
      jobId: 'acme-flags',
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
    expect(run).toHaveBeenCalledWith({
      args: ['--live', 'x'],
      flags: {},
      jobId: 'acme-report',
    });
  });

  it('runs as the given job id: argv, ctx.jobId and the crash label when there is no name (Decision 79)', async () => {
    const run = vi.fn();
    const { calls, deps } = fakeDeps();
    const job = defineRunnable({ id: 'acme-brief', domain: 'acme', run });
    await runJobModule(job, ['x'], deps, { jobId: 'acme-brief-clinical' });
    expect(process.argv.slice(1)).toEqual(['acme-brief-clinical', 'x']);
    expect(run).toHaveBeenCalledWith({
      args: ['x'],
      flags: {},
      jobId: 'acme-brief-clinical',
    });
    await runJobModule(job, [], deps, { jobId: 'acme-brief-industry' });
    expect(calls.map((c) => c.name)).toEqual([
      'acme-brief-clinical',
      'acme-brief-industry',
    ]);
  });

  it('passes the given config to the prerequisite and the run as ctx.config', async () => {
    const seen: unknown[] = [];
    const { deps } = fakeDeps();
    await runJobModule(
      defineRunnable({
        id: 'acme-brief',
        domain: 'acme',
        prerequisite: ({ config }) => {
          seen.push(config);
          return true;
        },
        run: ({ config }) => {
          seen.push(config);
        },
      }),
      [],
      deps,
      { config: { channel: 'C1' } },
    );
    expect(seen).toEqual([{ channel: 'C1' }, { channel: 'C1' }]);
  });

  it('keeps a declared name as the crash label whatever the job id', async () => {
    const { calls, deps } = fakeDeps();
    await runJobModule(
      defineRunnable({
        id: 'acme-brief',
        domain: 'acme',
        name: 'acme/brief',
        run: () => undefined,
      }),
      [],
      deps,
      { jobId: 'acme-brief-clinical' },
    );
    expect(calls.map((c) => c.name)).toEqual(['acme/brief']);
  });

  it('passes a caller-given job id through to run, prerequisite and doctorCheck', async () => {
    const run = vi.fn();
    const prerequisite = vi.fn(() => true as const);
    const doctorCheck = vi.fn(() => true as const);
    const job = defineRunnable({
      id: 'acme-brief',
      domain: 'acme',
      prerequisite,
      doctorCheck,
      run,
    });
    const ctx = { args: [], jobId: 'acme-brief-x' };
    await job.prerequisite?.(ctx);
    await job.doctorCheck?.(ctx);
    await job.run(ctx);
    for (const fn of [prerequisite, doctorCheck, run])
      expect(fn).toHaveBeenCalledWith({
        args: [],
        flags: {},
        jobId: 'acme-brief-x',
      });
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
        prerequisite: () => 'no acme block in the instance config',
        run,
      }),
      [],
      deps,
    );
    expect(run).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      '[skip] no acme block in the instance config',
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

  it('never runs doctorCheck: that is for doctor, with the parsed flags', async () => {
    const run = vi.fn();
    const doctorCheck = vi.fn(() => 'rsync not found' as const);
    const { deps, log } = fakeDeps();
    const job = defineRunnable({
      id: 'acme-report',
      domain: 'acme',
      flags: { live: argFlag('--live') },
      doctorCheck,
      run,
    });
    await runJobModule(job, [], deps);
    expect(run).toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(doctorCheck).not.toHaveBeenCalled();
    expect(await job.doctorCheck?.({ args: ['--live'] })).toBe(
      'rsync not found',
    );
    expect(doctorCheck).toHaveBeenCalledWith({
      args: ['--live'],
      flags: { live: true },
      jobId: 'acme-report',
    });
  });
});
