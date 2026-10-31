import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parsePunchList } from '../model/parse.js';
import { reportItem, testConfig } from '../punch-list.test-helper.js';
import { dayFile } from '../store.js';
import { readCursor, writeCursor } from './input.js';
import { type HarvestDeps, runHarvest } from './run.js';

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'pl-harvest-'));
  const listDir = join(dir, 'punch-list');
  const input = join(dir, 'content');
  mkdirSync(listDir, { recursive: true });
  mkdirSync(input, { recursive: true });
  writeFileSync(join(listDir, 'TASK.md'), '# Harvest\n\nDo the thing.');
  writeFileSync(join(input, 'new.json'), '{}');
  const inWindow = new Date('2026-10-18T12:00:00Z');
  utimesSync(join(input, 'new.json'), inWindow, inWindow);
  const serverConfig = join(dir, 'server.json');
  writeFileSync(
    serverConfig,
    JSON.stringify({
      publicUrl: 'https://jeeves.example.com',
      roots: { t: dir },
    }),
  );
  const config = testConfig({
    dir: listDir,
    serverConfig,
    timeZone: 'UTC',
    specPath: join(dir, 'spec.md'),
    cursorFile: join(dir, 'state', 'cursor.json'),
    inboxDir: join(dir, 'state', 'inbox'),
    lockFile: join(dir, 'state', 'pl.lock'),
    inputRoots: [input],
    slack: { channel: 'C000PUNCH01', account: 'default', pinnedTs: '1.2' },
  });
  const calls = {
    tasks: [] as string[],
    reportFiles: [] as string[],
    posts: [] as string[],
    updates: [] as string[],
    logs: [] as string[],
  };
  const deps = (reply: string): HarvestDeps => ({
    worker: (task, reportFile) => {
      calls.tasks.push(task);
      calls.reportFiles.push(reportFile);
      writeFileSync(reportFile, reply);
      return Promise.resolve(reply);
    },
    slack: () => ({
      post: (_c, t) => {
        calls.posts.push(t);
        return Promise.resolve();
      },
      update: (_c, _ts, t) => {
        calls.updates.push(t);
        return Promise.resolve();
      },
    }),
    now: () => new Date('2026-10-18T21:47:00Z'),
    log: (m) => calls.logs.push(m),
  });
  return { dir, listDir, input, config, calls, deps };
};

const reply = (sources: string[]): string =>
  JSON.stringify({ items: [reportItem({ sources })], summary: 'One need.' });

describe('runHarvest', () => {
  it('dispatches, merges, records, posts, pins and advances the cursor', async () => {
    const s = setup();
    await runHarvest(
      s.config,
      { live: true, printTask: false },
      s.deps(reply([join(s.input, 'new.json')])),
    );
    expect(s.calls.tasks[0]).toContain('Do the thing.');
    expect(s.calls.tasks[0]).toContain('## Output contract');
    const list = parsePunchList(
      readFileSync(dayFile(s.listDir, '2026-10-18'), 'utf8'),
    );
    expect(list.backlog[0]?.text).toContain(
      '[new](https://jeeves.example.com/browse/t/content/new.json)',
    );
    expect(
      JSON.parse(
        readFileSync(
          join(s.listDir, 'harvest', '2026-10-18T21-47-00Z.json'),
          'utf8',
        ),
      ),
    ).toMatchObject({
      since: '2026-10-17T21:47:00.000Z',
      added: [{ title: 'Ignore .meta lock files' }],
      delivered: true,
    });
    expect(s.calls.posts[0]).toContain('1 new backlog item(s)');
    expect(s.calls.updates[0]).toContain(
      '<https://jeeves.example.com/browse/t/punch-list/2026-10-18.md|open>',
    );
    expect(readCursor(s.config.cursorFile)?.toISOString()).toBe(
      '2026-10-18T21:47:00.000Z',
    );
  });

  it('skips the worker when nothing is new, but still rolls over and pins', async () => {
    const s = setup();
    writeCursor(s.config.cursorFile, new Date('2026-10-19T00:00:00Z'));
    await runHarvest(
      s.config,
      { live: true, printTask: false },
      s.deps('unused'),
    );
    expect(s.calls.tasks).toEqual([]);
    expect(s.calls.updates).toEqual([
      expect.stringContaining('/browse/t/punch-list/2026-10-18.md'),
    ]);
    expect(
      parsePunchList(readFileSync(dayFile(s.listDir, '2026-10-18'), 'utf8'))
        .date,
    ).toBe('2026-10-18');
  });

  it('fails on a bad report without advancing the cursor or posting', async () => {
    const s = setup();
    await expect(
      runHarvest(s.config, { live: true, printTask: false }, s.deps('no json')),
    ).rejects.toThrow('harvest worker reply holds no JSON object');
    expect(readCursor(s.config.cursorFile)?.toISOString()).toBe(
      '2026-10-17T21:47:00.000Z',
    );
    expect(s.calls.posts).toEqual([]);
  });

  it('retries a failed first run over the same window', async () => {
    const s = setup();
    await expect(
      runHarvest(s.config, { live: true, printTask: false }, s.deps('no json')),
    ).rejects.toThrow('harvest worker reply holds no JSON object');
    const later = {
      ...s.deps(reply([join(s.input, 'new.json')])),
      now: () => new Date('2026-10-19T21:47:00Z'),
    };
    await runHarvest(s.config, { live: true, printTask: false }, later);
    expect(s.calls.tasks.at(-1)).toContain(
      'Window: 2026-10-17T21:47:00.000Z to 2026-10-19T21:47:00.000Z',
    );
  });

  it('finishes an undelivered harvest without dispatching it again', async () => {
    const s = setup();
    const slackDown = {
      ...s.deps(reply([join(s.input, 'new.json')])),
      slack: () => ({
        post: () => Promise.reject(new Error('slack down')),
        update: () => Promise.resolve(),
      }),
    };
    await expect(
      runHarvest(s.config, { live: true, printTask: false }, slackDown),
    ).rejects.toThrow('slack down');
    const record = join(s.listDir, 'harvest', '2026-10-18T21-47-00Z.json');
    expect(JSON.parse(readFileSync(record, 'utf8'))).toMatchObject({
      delivered: false,
    });
    const dispatched = [...s.calls.tasks];
    expect(dispatched.length).toBe(1);
    writeCursor(s.config.cursorFile, new Date('2026-10-19T00:00:00Z'));
    await runHarvest(
      s.config,
      { live: true, printTask: false },
      s.deps('unused'),
    );
    expect(s.calls.tasks).toEqual(dispatched);
    expect(s.calls.posts[0]).toContain('1 new backlog item(s)');
    expect(JSON.parse(readFileSync(record, 'utf8'))).toMatchObject({
      delivered: true,
    });
    const list = parsePunchList(
      readFileSync(dayFile(s.listDir, '2026-10-18'), 'utf8'),
    );
    expect(list.backlog.map((e) => e.text.split(' \u2014 ')[0])).toEqual([
      '**Ignore .meta lock files**',
    ]);
  });

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
  });

  it('tells the worker where to write its report and removes it once recorded', async () => {
    const s = setup();
    await runHarvest(
      s.config,
      { live: true, printTask: false },
      s.deps(reply([join(s.input, 'new.json')])),
    );
    const file = join(s.config.inboxDir, '2026-10-18T21-47-00Z.json');
    expect(s.calls.reportFiles).toEqual([file]);
    expect(s.calls.tasks[0]).toContain(
      `to \`${file}\` with the \`write\` tool`,
    );
    expect(existsSync(file)).toBe(false);
  });
});

describe('runHarvest without the optional settings', () => {
  it('leaves the spec out, skips an unlinkable item by name and leaves the pinned message alone', async () => {
    const s = setup();
    const { specPath: _spec, ...rest } = s.config;
    const config = {
      ...rest,
      slack: { channel: 'C000PUNCH01', account: 'default' },
    };
    await runHarvest(
      config,
      { live: true, printTask: false },
      s.deps(
        JSON.stringify({
          items: [
            reportItem({ sources: [join(s.input, 'new.json')] }),
            reportItem({
              title: 'Outside every root',
              sources: [join(tmpdir(), 'elsewhere', 'x.json')],
            }),
          ],
          summary: 'Two needs.',
        }),
      ),
    );
    expect(s.calls.tasks[0]).not.toContain('Punch-list spec:');
    expect(s.calls.logs).toContain(
      'skipped "Outside every root": no linkable source',
    );
    expect(s.calls.logs).toContain('worker reported 2 item(s); 1 to add');
    expect(s.calls.logs).toContain(
      'no pinned message ts configured; quick links not updated',
    );
    expect(s.calls.updates).toEqual([]);
  });
});

describe('runHarvest task', () => {
  it('names its task source before dispatching, and the configured spec in the task', async () => {
    const s = setup();
    await runHarvest(
      s.config,
      { live: true, printTask: false },
      s.deps(reply([join(s.input, 'new.json')])),
    );
    expect(s.calls.logs[0]).toBe(
      `task from the instance file ${join(s.listDir, 'TASK.md')}`,
    );
    expect(s.calls.tasks[0]).toContain(
      `- Punch-list spec: ${s.config.specPath ?? ''}`,
    );
  });
});
