/**
 * Tests for the task-file dispatcher: silo-relative task paths with config
 * overrides, the `[skip]` guard, date-context injection, and routing to
 * `dispatchWithSlack` vs the runner's `runDispatcher`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONFIG_PATH_ENV, resetConfig } from '../../config/loader.js';
import { UnknownSiloError } from '../../config/silo-router.js';
import type { TaskFileDispatcherDeps } from './task-file-dispatcher.js';
import { dispatchTaskFile, resolveTaskFile } from './task-file-dispatcher.js';

let dir: string;
let savedEnv: string | undefined;

const writeConfig = (jobs: Record<string, unknown> = {}): void => {
  const configPath = path.join(dir, 'jeeves-scripts.json');
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      instance: { name: 't', baseDir: dir },
      paths: { contentDir: path.join(dir, 'content') },
      siloRouting: {
        silos: { acme: { basePath: path.join(dir, 'acme') } },
      },
      jobs,
    }),
  );
  process.env[CONFIG_PATH_ENV] = configPath;
  resetConfig();
};

const writeTask = (rel: string, text = 'Do the thing.'): string => {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};

const makeDeps = () => {
  const deps = {
    dispatchWithSlack: vi.fn<TaskFileDispatcherDeps['dispatchWithSlack']>(),
    runDispatcher: vi.fn<TaskFileDispatcherDeps['runDispatcher']>(),
    now: () => new Date('2026-05-11T12:00:00Z'),
    log: vi.fn<(message: string) => void>(),
  };
  deps.dispatchWithSlack.mockResolvedValue({ task: '', posts: [], posted: 0 });
  return deps;
};

beforeEach(() => {
  savedEnv = process.env[CONFIG_PATH_ENV];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfd-'));
  writeConfig();
});

afterEach(() => {
  process.env[CONFIG_PATH_ENV] = savedEnv;
  resetConfig();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('resolveTaskFile', () => {
  it('resolves against the default silo when none is given', () => {
    expect(resolveTaskFile({ jobId: 'j', taskFile: 'digest/TASK.md' })).toBe(
      path.join(dir, 'content', 'digest', 'TASK.md'),
    );
  });

  it('resolves against a named silo', () => {
    expect(
      resolveTaskFile({ jobId: 'j', silo: 'acme', taskFile: 'ops/TASK.md' }),
    ).toBe(path.join(dir, 'acme', 'ops', 'TASK.md'));
  });

  it('lets jobs.<id>.silo and .taskFile in config override the caller', () => {
    writeConfig({ j: { silo: 'acme', taskFile: 'moved/TASK.md' } });
    expect(resolveTaskFile({ jobId: 'j', taskFile: 'digest/TASK.md' })).toBe(
      path.join(dir, 'acme', 'moved', 'TASK.md'),
    );
  });

  it('fails on an unknown silo', () => {
    expect(() =>
      resolveTaskFile({ jobId: 'j', silo: 'nope', taskFile: 'TASK.md' }),
    ).toThrow(UnknownSiloError);
  });
});

describe('dispatchTaskFile', () => {
  it('skips, logging the path, when the task file is missing', async () => {
    const deps = makeDeps();
    const result = await dispatchTaskFile(
      { scriptName: 's', jobId: 'j', taskFile: 'digest/TASK.md' },
      deps,
    );
    expect(result).toBe('skipped');
    expect(deps.log).toHaveBeenCalledWith(
      `[skip] s: no task file at ${path.join(dir, 'content', 'digest', 'TASK.md')}`,
    );
    expect(deps.runDispatcher).not.toHaveBeenCalled();
    expect(deps.dispatchWithSlack).not.toHaveBeenCalled();
  });

  it('uses runDispatcher with the dispatch options when no Slack config is given', async () => {
    writeTask('content/digest/TASK.md');
    const deps = makeDeps();
    const result = await dispatchTaskFile(
      {
        scriptName: 's',
        jobId: 'j',
        thinking: 'low',
        taskFile: 'digest/TASK.md',
      },
      deps,
    );
    expect(result).toBe('dispatched');
    expect(deps.runDispatcher).toHaveBeenCalledWith('Do the thing.', {
      jobId: 'j',
      thinking: 'low',
    });
    expect(deps.dispatchWithSlack).not.toHaveBeenCalled();
  });

  it('routes through dispatchWithSlack, resolving a lazy Slack config', async () => {
    writeTask('acme/ops/TASK.md');
    const deps = makeDeps();
    const slack = { accountId: 'a', posts: [{ target: 'C1', purpose: 'p' }] };
    await dispatchTaskFile(
      {
        scriptName: 's',
        jobId: 'j',
        silo: 'acme',
        taskFile: 'ops/TASK.md',
        slack: () => slack,
      },
      deps,
    );
    expect(deps.dispatchWithSlack).toHaveBeenCalledWith(
      'Do the thing.',
      { jobId: 'j' },
      slack,
    );
    expect(deps.runDispatcher).not.toHaveBeenCalled();
  });

  it('prefixes the date in the given zone', async () => {
    writeTask('content/TASK.md');
    const deps = makeDeps();
    await dispatchTaskFile(
      {
        scriptName: 's',
        jobId: 'j',
        taskFile: 'TASK.md',
        dateTimeZone: 'America/Chicago',
      },
      deps,
    );
    const [task] = deps.runDispatcher.mock.calls[0] ?? [''];
    expect(task).toMatch(
      /^> \*\*Today is Monday, 2026-05-11 \(America\/Chicago\)\.\*\*/,
    );
    expect(task.endsWith('\n\nDo the thing.')).toBe(true);
  });

  it('adds no date line without a zone', async () => {
    writeTask('content/TASK.md');
    const deps = makeDeps();
    await dispatchTaskFile(
      { scriptName: 's', jobId: 'j', taskFile: 'TASK.md' },
      deps,
    );
    expect(deps.runDispatcher.mock.calls[0]?.[0]).toBe('Do the thing.');
  });

  it('evaluates a zone function only once the task file exists, and propagates its error', async () => {
    const zone = vi.fn<() => string>(() => {
      throw new Error('No time zone configured');
    });
    const deps = makeDeps();
    await dispatchTaskFile(
      { scriptName: 's', jobId: 'j', taskFile: 'TASK.md', dateTimeZone: zone },
      deps,
    );
    expect(zone).not.toHaveBeenCalled();

    writeTask('content/TASK.md');
    await expect(
      dispatchTaskFile(
        {
          scriptName: 's',
          jobId: 'j',
          taskFile: 'TASK.md',
          dateTimeZone: zone,
        },
        deps,
      ),
    ).rejects.toThrow('No time zone configured');
    expect(deps.runDispatcher).not.toHaveBeenCalled();
  });

  it('propagates a failing Slack dispatch', async () => {
    writeTask('content/TASK.md');
    const deps = makeDeps();
    deps.dispatchWithSlack.mockRejectedValueOnce(new Error('bad posts'));
    await expect(
      dispatchTaskFile(
        { scriptName: 's', jobId: 'j', taskFile: 'TASK.md', slack: {} },
        deps,
      ),
    ).rejects.toThrow('bad posts');
  });
});
