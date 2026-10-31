/**
 * The harvester's `--print-task` and dry-run paths: a dry run dispatches
 * the worker but leaves no file, record, cursor, inbox, report or pinned
 * update behind, even when the worker fails.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { dayFile } from '../store.js';
import { readCursor } from './input.js';
import { runHarvest } from './run.js';
import { reply, setup } from './run.test-helper.js';

describe('runHarvest --print-task and dry run', () => {
  it('prints the task only, and dry-runs without writing', async () => {
    const s = setup();
    await runHarvest(
      s.config,
      { live: true, printTask: true },
      s.deps('unused'),
    );
    expect(s.calls.tasks).toEqual([]);
    expect(s.calls.logs[0]).toBe(
      `task from the instance file ${join(s.listDir, 'TASK.md')}`,
    );
    expect(s.calls.logs[1]).toContain('Do the thing.');
    expect(s.calls.logs).toHaveLength(2);
    await runHarvest(
      s.config,
      { live: false, printTask: false },
      s.deps(reply([join(s.input, 'new.json')])),
    );
    expect(existsSync(dayFile(s.listDir, '2026-10-18'))).toBe(false);
    expect(readCursor(s.config.cursorFile)).toBeUndefined();
    expect(s.calls.posts).toEqual([]);
    expect(s.calls.logs.some((l) => l.includes('[dry-run] would post'))).toBe(
      true,
    );
    // No harvest record, no pinned-message update, no inbox, no leftover report.
    expect(existsSync(join(s.listDir, 'harvest'))).toBe(false);
    expect(s.calls.updates).toEqual([]);
    expect(
      s.calls.logs.some((l) => l.startsWith('[dry-run] would update pinned')),
    ).toBe(true);
    expect(existsSync(s.config.inboxDir)).toBe(false);
    const [report] = s.calls.reportFiles;
    expect(report?.startsWith(s.config.inboxDir)).toBe(false);
    expect(report && existsSync(dirname(report))).toBe(false);
    // Cursor, inbox and lock all live under state/: nothing created it.
    expect(existsSync(join(s.dir, 'state'))).toBe(false);
  });

  it('removes a dry run’s report directory when the worker fails', async () => {
    const s = setup();
    await expect(
      runHarvest(
        s.config,
        { live: false, printTask: false },
        s.deps('no json'),
      ),
    ).rejects.toThrow('harvest worker reply holds no JSON object');
    const [report] = s.calls.reportFiles;
    expect(report && existsSync(dirname(report))).toBe(false);
    expect(existsSync(s.config.inboxDir)).toBe(false);
  });
});
