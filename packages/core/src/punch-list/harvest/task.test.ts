import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { coreTaskTemplatePath } from '../../lib/task-template.js';
import { emptyPunchList } from '../model/types.js';
import {
  backlogDigest,
  buildTask,
  HARVEST_TEMPLATE,
  outputContract,
} from './task.js';

const list = {
  ...emptyPunchList('2026-10-18'),
  backlog: [{ id: 'b-00000001', checked: false, text: '**X** — y' }],
  processedBacklog: [
    {
      id: 'b-00000002',
      checked: true,
      text: '**Z** — w → rejected · processed 2026-10-17',
    },
  ],
};

describe('backlogDigest', () => {
  it('lists open and processed items, with the processed date', () => {
    expect(backlogDigest(list)).toEqual([
      '- open: **X** — y',
      '- processed 2026-10-17: **Z** — w → rejected · processed 2026-10-17',
    ]);
  });
});

describe('backlogDigest coverage', () => {
  it('also lists tasks, finished tasks and every milestone', () => {
    const digest = backlogDigest({
      ...emptyPunchList('2026-10-18'),
      tasks: [{ id: 't-00000001', checked: false, text: '**T** — a' }],
      completedTasks: [
        {
          id: 't-00000002',
          checked: true,
          text: '**C** — b · done 2026-10-18',
        },
      ],
      todo: [{ slug: 'acme-a', title: 'A', body: [], status: [] }],
      integrated: [
        {
          slug: 'acme-b',
          title: 'B',
          body: [],
          status: [],
          integratedOn: '2026-10-18',
        },
      ],
    });
    expect(digest).toEqual([
      '- task: **T** — a',
      '- task done 2026-10-18: **C** — b · done 2026-10-18',
      '- milestone (todo): acme-a — A',
      '- milestone (integrated): acme-b — B',
    ]);
  });
});

describe('buildTask', () => {
  const options = (dir: string) => ({
    dir,
    reportFile: '/inbox/run.json',
    list,
    since: new Date('2026-10-17T21:47:00Z'),
    now: new Date('2026-10-18T21:47:00Z'),
    timeZone: 'UTC',
    inputRoots: ['/base/content/email', '/base/content/slack'],
  });

  it('puts the standing orders, the window, the inputs, the digest and the contract in order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pl-task-'));
    writeFileSync(join(dir, 'TASK.md'), '# Harvest\n\nDo the thing.\n');
    const { text } = buildTask(options(dir));
    const order = [
      'Do the thing.',
      'Window: 2026-10-17T21:47:00.000Z to 2026-10-18T21:47:00.000Z',
      '- Input paths: /base/content/email, /base/content/slack',
      `- Earlier punch-list files and harvest reports: ${dir}`,
      '- open: **X**',
      outputContract('/inbox/run.json'),
    ].map((s) => text.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('uses the instance TASK.md when it has one, and says so', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pl-task-'));
    writeFileSync(join(dir, 'TASK.md'), 'Own orders.');
    const { text, source } = buildTask(options(dir));
    expect(source).toBe(`task from the instance file ${join(dir, 'TASK.md')}`);
    expect(text).toContain('Own orders.');
    expect(text).not.toContain('# Punch-list harvest');
  });

  it("uses core's bundled template without a TASK.md, and says so", () => {
    const dir = mkdtempSync(join(tmpdir(), 'pl-task-'));
    const { text, source } = buildTask(options(dir));
    expect(source).toBe(
      `task from core template ${HARVEST_TEMPLATE} (no instance file at ${join(dir, 'TASK.md')})`,
    );
    const template = readFileSync(
      coreTaskTemplatePath(HARVEST_TEMPLATE),
      'utf8',
    );
    expect(text).toContain(template.trim());
  });

  it('names the spec only when one is configured', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pl-task-'));
    expect(buildTask(options(dir)).text).not.toContain('Punch-list spec:');
    expect(
      buildTask({ ...options(dir), specPath: '/base/content/spec.md' }).text,
    ).toContain('- Punch-list spec: /base/content/spec.md');
  });

  it('stamps the date in the configured zone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pl-task-'));
    const { text } = buildTask({ ...options(dir), timeZone: 'Asia/Tokyo' });
    expect(text.split('\n')[0]).toBe(
      '> **Today is Monday, 2026-10-19 (Asia/Tokyo).** Use this as the authoritative date reference for all dates in this report.',
    );
  });

  it('says so when nothing is on the list yet', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pl-task-'));
    const { text } = buildTask({
      ...options(dir),
      list: emptyPunchList('2026-10-18'),
    });
    expect(text).toContain('- (nothing yet)');
  });
});

describe('backlogDigest without markers', () => {
  it('leaves the date out of a finished entry that has none', () => {
    const bare = {
      ...emptyPunchList('2026-10-18'),
      completedTasks: [
        { id: 't-00000001', checked: true, text: '**Done thing**' },
      ],
      processedBacklog: [
        { id: 'b-00000001', checked: true, text: '**Old idea**' },
      ],
    };
    expect(backlogDigest(bare)).toEqual([
      '- task done : **Done thing**',
      '- processed : **Old idea**',
    ]);
  });
});
