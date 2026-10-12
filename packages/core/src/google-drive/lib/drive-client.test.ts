import { describe, expect, it } from 'vitest';

import { createDriveClient, quoteSheetTitle } from './drive-client.js';

/** An exec answering by the gog subcommand, recording every call. */
const exec = (answers: Record<string, unknown[]>) => {
  const calls: string[][] = [];
  const run = (args: string[]): string => {
    calls.push(args);
    const key = args
      .slice(args.indexOf('--account') + 2)
      .slice(0, 2)
      .join(' ');
    const queue =
      answers[key] ?? answers[args.find((a) => a in answers) ?? ''] ?? [];
    return JSON.stringify(queue.shift() ?? {});
  };
  return { run, calls };
};

describe('createDriveClient', () => {
  it('downloads and exports to the path gog reports', () => {
    const e = exec({ download: [{ path: '/s/a.bin' }, { path: '/s/a.md' }] });
    const c = createDriveClient('me@example.com', e.run);
    expect(c.downloadTo('F1', '/s/a.dl')).toBe('/s/a.bin');
    expect(c.exportTo('F1', 'md', '/s/a.dl')).toBe('/s/a.md');
    expect(e.calls[0]).toContain('--overwrite');
    expect(e.calls[1]).toEqual(expect.arrayContaining(['--format', 'md']));
  });

  it('pages revisions and keeps the last id, or null when there are none', () => {
    const e = exec({
      revisions: [
        { revisions: [{ id: 'r1' }], nextPageToken: 'p2' },
        { revisions: [] },
        { revisions: [] },
      ],
    });
    const c = createDriveClient('me@example.com', e.run);
    expect(c.latestRevisionId('F1')).toBe('r1');
    expect(e.calls[1]).toEqual(expect.arrayContaining(['--page', 'p2']));
    expect(c.latestRevisionId('F2')).toBeNull();
  });

  it('reads sheet tabs and quoted tab values', () => {
    const e = exec({
      metadata: [{ sheets: [{ properties: { title: "It's" } }] }],
      get: [{ values: [['a']] }],
    });
    const c = createDriveClient('me@example.com', e.run);
    expect(c.sheetTabs('S')).toEqual(["It's"]);
    expect(c.sheetValues('S', "It's")).toEqual([['a']]);
    expect(e.calls[1]).toContain(quoteSheetTitle("It's"));
  });
});
