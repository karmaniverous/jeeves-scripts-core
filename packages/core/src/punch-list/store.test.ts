import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parsePunchList } from './model/parse.js';
import { renderPunchList } from './model/render.js';
import { emptyPunchList } from './model/types.js';
import { dayFile, latestBefore, loadToday, updateToday } from './store.js';

const tmp = (): string => mkdtempSync(join(tmpdir(), 'punch-list-'));

const withTask = (date: string, checked: boolean): string =>
  renderPunchList({
    ...emptyPunchList(date),
    tasks: [{ id: 't-00000001', checked, text: '**A** — added 2026-10-01' }],
  });

describe('store', () => {
  it('finds the latest earlier file', () => {
    const dir = tmp();
    writeFileSync(dayFile(dir, '2026-10-16'), withTask('2026-10-16', false));
    writeFileSync(dayFile(dir, '2026-10-17'), withTask('2026-10-17', false));
    writeFileSync(join(dir, 'TASK.md'), 'x');
    expect(latestBefore(dir, '2026-10-18')).toBe(dayFile(dir, '2026-10-17'));
    expect(latestBefore(dir, '2026-10-16')).toBeUndefined();
    expect(latestBefore(join(dir, 'missing'), '2026-10-18')).toBeUndefined();
  });

  it('rolls today over from the previous file, applying ticks', () => {
    const dir = tmp();
    writeFileSync(dayFile(dir, '2026-10-17'), withTask('2026-10-17', true));
    const { list, text } = loadToday({
      dir,
      today: '2026-10-18',
      retentionDays: 30,
    });
    expect(text).toBeUndefined();
    expect(list.date).toBe('2026-10-18');
    expect(list.completedTasks[0]?.text).toMatch(/done 2026-10-18$/);
  });

  it('starts empty with no earlier file', () => {
    expect(
      loadToday({ dir: tmp(), today: '2026-10-18', retentionDays: 30 }).list,
    ).toEqual(emptyPunchList('2026-10-18'));
  });

  it('writes changes, and writes nothing in a dry run or without change', () => {
    const dir = tmp();
    const opts = {
      dir,
      today: '2026-10-18',
      retentionDays: 30,
      lockFile: join(dir, '.lock'),
    };
    const dry = updateToday({ ...opts, dryRun: true }, (list) => ({
      list,
      result: 1,
    }));
    expect(dry.changed).toBe(true);
    expect(() => readFileSync(dayFile(dir, '2026-10-18'))).toThrow();
    const live = updateToday(opts, (list) => ({ list, result: 2 }));
    expect(live.result).toBe(2);
    expect(
      parsePunchList(readFileSync(dayFile(dir, '2026-10-18'), 'utf8')),
    ).toEqual(live.list);
    expect(updateToday(opts, (list) => ({ list, result: 3 })).changed).toBe(
      false,
    );
  });

  it('retries when the file changes between read and write', () => {
    const dir = tmp();
    const opts = {
      dir,
      today: '2026-10-18',
      retentionDays: 30,
      lockFile: join(dir, '.lock'),
    };
    writeFileSync(dayFile(dir, '2026-10-18'), withTask('2026-10-18', false));
    let calls = 0;
    const res = updateToday(opts, (list) => {
      calls++;
      if (calls === 1)
        writeFileSync(dayFile(dir, '2026-10-18'), withTask('2026-10-18', true));
      return {
        list: {
          ...list,
          backlog: [{ id: 'b-00000002', checked: false, text: 'B' }],
        },
        result: calls,
      };
    });
    expect(res.result).toBe(2);
    expect(res.list.tasks[0]?.checked).toBe(true);
  });

  it('gives up after repeated concurrent changes', () => {
    const dir = tmp();
    const file = dayFile(dir, '2026-10-18');
    writeFileSync(file, withTask('2026-10-18', false));
    let n = 0;
    expect(() =>
      updateToday(
        {
          dir,
          today: '2026-10-18',
          retentionDays: 30,
          lockFile: join(dir, '.lock'),
          attempts: 2,
        },
        (list) => {
          writeFileSync(file, withTask('2026-10-18', n++ % 2 === 0));
          return {
            list: {
              ...list,
              backlog: [{ id: 'b-00000003', checked: false, text: 'C' }],
            },
            result: 0,
          };
        },
      ),
    ).toThrow(/kept changing/);
  });
});
