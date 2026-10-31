import { describe, expect, it } from 'vitest';

import { rsyncArgs, rsyncPath, summarizeRsync } from './rsync.js';

describe('rsyncPath', () => {
  it('leaves paths unchanged off Windows', () => {
    expect(rsyncPath('/base/state/x', 'linux')).toBe('/base/state/x');
    expect(rsyncPath('C:\\a', 'darwin')).toBe('C:\\a');
  });

  it("converts Windows drive paths to Cygwin's /cygdrive form", () => {
    expect(rsyncPath('C:\\base\\state\\x', 'win32')).toBe(
      '/cygdrive/c/base/state/x',
    );
    expect(rsyncPath('D:/content/lib', 'win32')).toBe(
      '/cygdrive/d/content/lib',
    );
    expect(rsyncPath('C:\\', 'win32')).toBe('/cygdrive/c/');
  });

  it('converts UNC and relative Windows paths to forward slashes', () => {
    expect(rsyncPath('\\\\host\\share\\a', 'win32')).toBe('//host/share/a');
    expect(rsyncPath('a\\b', 'win32')).toBe('a/b');
  });
});

describe('rsyncArgs', () => {
  it('builds a checksum mirror with excludes, temp dir and dry run', () => {
    expect(
      rsyncArgs(
        {
          source: '/src/tree/',
          dest: '/dest',
          exclude: ['.meta/', '/.system/'],
          tempDir: '/tmp/x',
          dryRun: true,
        },
        'linux',
      ),
    ).toEqual([
      '--recursive',
      '--links',
      '--times',
      '--checksum',
      '--delete',
      '--itemize-changes',
      '--dry-run',
      '--temp-dir=/tmp/x',
      '--exclude=.meta/',
      '--exclude=/.system/',
      '/src/tree/',
      '/dest',
    ]);
  });

  it('omits dry run and temp dir when not requested', () => {
    const args = rsyncArgs(
      { source: '/a', dest: '/b', exclude: [], dryRun: false },
      'linux',
    );
    expect(args).not.toContain('--dry-run');
    expect(args.some((a) => a.startsWith('--temp-dir'))).toBe(false);
    expect(args.slice(-2)).toEqual(['/a/', '/b']);
  });

  it('converts every path argument on Windows, excludes untouched', () => {
    const args = rsyncArgs(
      {
        source: 'C:\\state\\clone\\sub\\',
        dest: 'D:\\content\\lib',
        exclude: ['.git/'],
        tempDir: 'C:\\state\\tmp',
        dryRun: false,
      },
      'win32',
    );
    expect(args.slice(-4)).toEqual([
      '--temp-dir=/cygdrive/c/state/tmp',
      '--exclude=.git/',
      '/cygdrive/c/state/clone/sub/',
      '/cygdrive/d/content/lib',
    ]);
  });
});

describe('summarizeRsync', () => {
  it('counts writes, deletions, new directories and attribute-only touches', () => {
    const out = [
      'created directory /x',
      'cd+++++++++ author-b/',
      '>f+++++++++ author-b/author.md',
      '>fc.t...... author-a/x/SKILL.md',
      '*deleting   old/SKILL.md',
      '.d..t...... author-a/',
      '.f..t...... author-a/report/SKILL.md',
      '.f          unchanged/SKILL.md',
      '',
    ].join('\n');
    expect(summarizeRsync(out)).toEqual({
      written: 2,
      deleted: 1,
      dirsCreated: 1,
      touched: 1,
    });
  });

  it('counts nothing in empty output', () => {
    expect(summarizeRsync('')).toEqual({
      written: 0,
      deleted: 0,
      dirsCreated: 0,
      touched: 0,
    });
  });
});
