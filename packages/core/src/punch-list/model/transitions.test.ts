import { describe, expect, it } from 'vitest';

import { first, samplePunchList } from '../punch-list.test-helper.js';
import { getMarker } from './lines.js';
import { applyTicks, omitExpired, rollOver } from './transitions.js';
import type { ListEntry, Milestone, PunchList } from './types.js';

describe('applyTicks', () => {
  it('moves ticked entries and reopens unticked ones', () => {
    const ticked: PunchList = {
      ...samplePunchList,
      tasks: [{ ...first<ListEntry>(samplePunchList.tasks), checked: true }],
      backlog: [
        { ...first<ListEntry>(samplePunchList.backlog), checked: true },
      ],
      done: [{ ...first<Milestone>(samplePunchList.done), integrated: true }],
      completedTasks: [
        { ...first<ListEntry>(samplePunchList.completedTasks), checked: false },
      ],
      processedBacklog: [
        {
          ...first<ListEntry>(samplePunchList.processedBacklog),
          checked: false,
        },
      ],
    };
    const { list, moves } = applyTicks(ticked, '2026-10-20');
    expect(list.tasks.map((e) => e.id)).toEqual(['t-0000000c']);
    expect(list.tasks[0]?.text).toBe('**Old task** — added 2026-09-01');
    expect(list.completedTasks.map((e) => e.id)).toEqual(['t-0000000a']);
    expect(getMarker(list.completedTasks[0]?.text ?? '', 'done')).toBe(
      '2026-10-20',
    );
    expect(list.backlog.map((e) => e.id)).toEqual(['b-0000000d']);
    expect(list.processedBacklog[0]?.text).toMatch(/ · processed 2026-10-20$/);
    expect(list.done).toEqual([]);
    expect(list.integrated.at(-1)).toMatchObject({
      slug: 'acme-dropbox',
      integratedOn: '2026-10-20',
    });
    expect(list.integrated.at(-1)?.status).toEqual([
      '- Issues: a',
      '- Releases: b',
    ]);
    expect(moves.integrated).toEqual(['acme-dropbox']);
  });

  it('changes nothing without ticks', () => {
    expect(applyTicks(samplePunchList, '2026-10-20').list).toEqual(
      samplePunchList,
    );
  });
});

describe('omitExpired / rollOver', () => {
  it('leaves off finished entries older than the retention period', () => {
    const list = omitExpired(samplePunchList, '2026-10-18', 30);
    expect(list.completedTasks).toEqual([]);
    expect(list.integrated).toEqual([]);
    expect(omitExpired(samplePunchList, '2026-10-01', 30)).toEqual(
      samplePunchList,
    );
    expect(list.processedBacklog).toEqual(samplePunchList.processedBacklog);
  });

  it('rolls over to a new date, idempotently', () => {
    const next = rollOver(samplePunchList, '2026-10-19', 30);
    expect(next.date).toBe('2026-10-19');
    expect(rollOver(next, '2026-10-19', 30)).toEqual(next);
  });

  it('sends an unticked Integrated milestone back to Done, unticked', () => {
    const list: PunchList = {
      ...samplePunchList,
      done: [],
      integrated: [
        { ...first<Milestone>(samplePunchList.integrated), integrated: false },
      ],
    };
    const { list: next, moves } = applyTicks(list, '2026-09-02');
    expect(next.integrated).toEqual([]);
    expect(next.done).toEqual([
      {
        slug: 'acme-old',
        title: 'Old',
        body: ['x'],
        status: [],
        integrated: false,
      },
    ]);
    expect(moves.unintegrated).toEqual(['acme-old']);
  });
});
