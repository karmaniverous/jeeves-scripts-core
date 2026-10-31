/**
 * Tests for the task-file dispatcher with a core TASK template (Decision
 * 75): core's copy when the instance has no file, the instance file when
 * it has one, placeholder filling, and the source line every run logs.
 */

import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { BRIEFING_TEMPLATES, briefingVars } from './briefing.js';
import { dispatchTaskFile, runModeOf } from './task-file-dispatcher.js';
import { useDispatcherSandbox } from './task-file-dispatcher.test-helper.js';

const sandbox = useDispatcherSandbox();
const { writeTask, makeDeps } = sandbox;

describe('runModeOf', () => {
  it('is scheduled under jeeves-runner (JR_RUN_ID set), else on-demand', () => {
    expect(runModeOf({ JR_RUN_ID: '17' })).toBe('scheduled');
    expect(runModeOf({ JR_RUN_ID: '' })).toBe('on-demand');
    expect(runModeOf({})).toBe('on-demand');
  });
});

describe('dispatchTaskFile with a core template (Decision 75)', () => {
  const base = {
    scriptName: 'acme/brief',
    jobId: 'j',
    taskFile: 'brief/TASK.md',
    template: BRIEFING_TEMPLATES.marketIntel,
    templateVars: () => ({
      org: 'Acme',
      principal: 'Ana',
      timeZone: 'UTC',
      deliveryChannel: '#intel',
      marketIntelDir: '/c/intel',
    }),
  };
  const instanceFile = (): string =>
    path.join(sandbox.dir(), 'content', 'brief', 'TASK.md');

  it('uses core template when the instance has no file, fills it and says so', async () => {
    const deps = makeDeps();
    await expect(dispatchTaskFile(base, deps)).resolves.toBe('dispatched');
    expect(deps.log).toHaveBeenCalledWith(
      `acme/brief: task from core template ${BRIEFING_TEMPLATES.marketIntel} (no instance file at ${instanceFile()})`,
    );
    const [task = ''] = deps.runDispatcher.mock.calls[0] ?? [];
    expect(task.startsWith('# Acme market intel\n')).toBe(true);
    expect(task).toContain('`/c/intel/standing-orders.md`');
    expect(task).not.toMatch(/\{\{/);
  });

  it('uses the instance file when it exists, filling its placeholders', async () => {
    writeTask('content/brief/TASK.md', 'Brief {{principal}} at {{org}}.');
    const deps = makeDeps();
    await dispatchTaskFile(base, deps);
    expect(deps.log).toHaveBeenCalledWith(
      `acme/brief: task from the instance file ${instanceFile()}`,
    );
    expect(deps.runDispatcher.mock.calls[0]?.[0]).toBe('Brief Ana at Acme.');
  });

  it('fills placeholders with templateVars alone, and fails on a missing value', async () => {
    writeTask('content/brief/TASK.md', '{{who}} and {{what}}');
    const deps = makeDeps();
    await expect(
      dispatchTaskFile(
        {
          scriptName: 's',
          jobId: 'j',
          taskFile: 'brief/TASK.md',
          templateVars: { who: 'Ana' },
        },
        deps,
      ),
    ).rejects.toThrow('task template needs a value for {{what}}');
    expect(deps.runDispatcher).not.toHaveBeenCalled();
  });

  it('leaves an instance file without template or values unfilled, and names its source', async () => {
    writeTask('content/brief/TASK.md', 'Literal {{braces}}.');
    const deps = makeDeps();
    await dispatchTaskFile(
      { scriptName: 's', jobId: 'j', taskFile: 'brief/TASK.md' },
      deps,
    );
    expect(deps.log).toHaveBeenCalledWith(
      `s: task from the instance file ${instanceFile()}`,
    );
    expect(deps.runDispatcher.mock.calls[0]?.[0]).toBe('Literal {{braces}}.');
  });

  it.each([
    ['scheduled', 'This run is scheduled:'],
    ['on-demand', 'This run is on-demand:'],
  ] as const)('fills {{runMode}} with %s', async (runMode, line) => {
    const deps = { ...makeDeps(), runMode: () => runMode };
    await dispatchTaskFile(
      {
        ...base,
        template: BRIEFING_TEMPLATES.eod,
        templateVars: () =>
          briefingVars({
            org: 'Acme',
            principal: 'Ana',
            delegates: 'Bo',
            timeZone: 'UTC',
            deliveryChannel: '#eod',
            briefingDir: '/c/brief',
            eodDir: '/c/eod',
          }),
      },
      deps,
    );
    expect(deps.runDispatcher.mock.calls[0]?.[0]).toContain(line);
  });

  it('reads the run mode from the environment by default, and lets templateVars override it', async () => {
    writeTask('content/brief/TASK.md', 'Mode {{runMode}}.');
    const plain = { scriptName: 's', jobId: 'j', taskFile: 'brief/TASK.md' };
    vi.stubEnv('JR_RUN_ID', '42');
    const deps = makeDeps();
    await dispatchTaskFile({ ...plain, templateVars: {} }, deps);
    await dispatchTaskFile(
      { ...plain, templateVars: { runMode: 'on-demand' } },
      deps,
    );
    vi.unstubAllEnvs();
    expect(deps.runDispatcher.mock.calls.map(([task]) => task)).toEqual([
      'Mode scheduled.',
      'Mode on-demand.',
    ]);
  });

  it('fills core template without templateVars only when it has no placeholders', async () => {
    const deps = makeDeps();
    await expect(
      dispatchTaskFile({ ...base, templateVars: undefined }, deps),
    ).rejects.toThrow(/^task template needs a value for \{\{org\}\}/);
  });
});
