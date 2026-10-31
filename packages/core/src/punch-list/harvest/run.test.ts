/**
 * The harvester's live runs: dispatch, merge, record, post, pin, the
 * cursor, failure and resume. Dry runs: `run.dry-run.test.ts`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parsePunchList } from '../model/parse.js';
import { reportItem } from '../punch-list.test-helper.js';
import { dayFile } from '../store.js';
import { readCursor, writeCursor } from './input.js';
import { runHarvest } from './run.js';
import { reply, setup } from './run.test-helper.js';

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
