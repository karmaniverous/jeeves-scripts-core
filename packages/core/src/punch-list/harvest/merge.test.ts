import { describe, expect, it } from 'vitest';

import { emptyPunchList } from '../model/types.js';
import { reportItem } from '../punch-list.test-helper.js';
import { mergeItems } from './merge.js';

describe('mergeItems', () => {
  const link = (p: string): string | undefined =>
    p.startsWith('/ok/') ? `[${p}](https://x${p})` : undefined;

  it('adds linked items and skips duplicates and unlinkable ones', () => {
    const list = {
      ...emptyPunchList('2026-10-18'),
      backlog: [
        {
          id: 'b-00000001',
          checked: false,
          text: '**Dropbox support** — x · added 2026-10-17',
        },
      ],
    };
    const { list: next, result } = mergeItems(
      list,
      [
        reportItem({ title: 'Dropbox  support' }),
        reportItem({ sources: ['/missing/a.json'] }),
        reportItem({
          title: 'Budget alert · Gemini',
          kind: 'requested',
          requester: 'Pat Example',
          sources: ['/ok/a.json', 'runner:email-poll#9'],
        }),
      ],
      link,
      '2026-10-18',
      () => 'b-0000000f',
    );
    expect(result.added.map((a) => a.title)).toEqual(['Budget alert · Gemini']);
    expect(result.skipped.map((s) => s.reason)).toEqual([
      'already on the list',
      'no linkable source',
    ]);
    expect(next.backlog[1]).toEqual({
      id: 'b-0000000f',
      checked: false,
      text: '**Budget alert, Gemini** — The watcher logs ENOENT for deleted lock files. · requested by Pat Example · sources: [/ok/a.json](https://x/ok/a.json), `runner:email-poll#9` · added 2026-10-18',
    });
  });

  it('skips items already finished or promoted to a milestone', () => {
    const list = {
      ...emptyPunchList('2026-10-18'),
      completedTasks: [
        {
          id: 't-00000001',
          checked: true,
          text: '**Upload the logo** — x · done 2026-10-18',
        },
      ],
      done: [
        {
          slug: 'acme-dropbox',
          title: 'Dropbox support',
          body: [],
          status: [],
          integrated: false,
        },
      ],
    };
    const { result } = mergeItems(
      list,
      [
        reportItem({ title: 'Upload the logo' }),
        reportItem({ title: 'Dropbox support' }),
      ],
      link,
      '2026-10-18',
    );
    expect(result.added).toEqual([]);
    expect(result.skipped.map((s) => s.reason)).toEqual([
      'already on the list',
      'already on the list',
    ]);
  });
});
