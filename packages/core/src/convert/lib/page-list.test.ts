import { describe, expect, it } from 'vitest';

import { parsePageList, selectPages } from './page-list.js';

describe('parsePageList', () => {
  it('parses pages and inclusive ranges, ignoring whitespace', () => {
    expect(parsePageList('1-3, 7 ,5-5')).toEqual([
      [1, 3],
      [7, 7],
      [5, 5],
    ]);
  });

  it.each(['', '0', '3-1', 'a', '1-', '-2', '1,,2', '1.5', '2-0'])(
    'rejects %j',
    (list) => {
      expect(() => parsePageList(list)).toThrow(
        `Invalid page list "${list}": use 1-based pages and ranges, e.g. 1-3,7`,
      );
    },
  );
});

describe('selectPages', () => {
  it('selects every page without ranges', () => {
    expect(selectPages(undefined, 3, 'all')).toEqual([1, 2, 3]);
  });

  it('expands ranges, ascending and without duplicates', () => {
    expect(
      selectPages(
        [
          [4, 5],
          [1, 2],
          [2, 4],
        ],
        5,
        '4-5,1-2,2-4',
      ),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it('rejects a page past the end, naming the list and the page count', () => {
    expect(() => selectPages([[2, 4]], 3, '2-4')).toThrow(
      'Page list 2-4 is outside the document (3 pages)',
    );
    expect(() => selectPages([[2, 2]], 1, '2')).toThrow(
      'Page list 2 is outside the document (1 page)',
    );
  });

  it('rejects a page before the first', () => {
    expect(() => selectPages([[0, 1]], 3, '0,1')).toThrow(
      'Page list 0,1 is outside the document (3 pages)',
    );
  });

  it('checks the range before expanding it', () => {
    expect(() => selectPages([[1, 1e12]], 3, '1-1000000000000')).toThrow(
      /outside the document/,
    );
  });
});
