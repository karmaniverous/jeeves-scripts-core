/**
 * How `github-sync-files` reads, over a fake `gh`: on the instance side,
 * a `files[].source` that resolves outside the instance root (lexically,
 * absolutely or through a link) fails the run before any `gh` call; on the
 * GitHub side, only a 404 means a file is missing (any other failed read
 * fails that repo), and files are compared by git blob SHA, so a file
 * over 1 MB (returned without `content`) that is unchanged is skipped.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { gitBlobSha } from './lib/file-sync.js';
import {
  ACCOUNT,
  fail,
  ORG,
  type SyncFilesWorld,
  syncFilesWorld,
  TARGET,
} from './lib/file-sync-gh.test-helper.js';
import { syncAll } from './sync-files.js';

let w: SyncFilesWorld | undefined;
const world = (override?: Parameters<typeof syncFilesWorld>[0]) =>
  (w = syncFilesWorld(override));
let outside: string;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-files-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.md'), 'host secret');
});
afterEach(() => {
  w?.cleanup();
  w = undefined;
  fs.rmSync(outside, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const LAST_RUN = 'github-sync-files|last-run';

describe('gitBlobSha', () => {
  it('is the SHA git gives the blob', () => {
    // `printf 'hello\n' | git hash-object --stdin`
    expect(gitBlobSha(Buffer.from('hello\n'))).toBe(
      'ce013625030ba8dba906f756967f9e9ca394464a',
    );
  });
});

describe('files[].source outside the instance root', () => {
  it.each([
    ['a .. path', () => '../outside.md'],
    ['an absolute path', () => path.join(outside, 'secret.md')],
  ])('refuses %s before any gh call', (_what, source) => {
    const x = world();
    expect(() => {
      syncAll(
        x.settings({ files: [{ source: source(), target: 'a.md' }] }),
        x.deps,
      );
    }).toThrow(/resolves outside the instance root/);
    expect(x.calls()).toEqual([]);
  });

  it('refuses a source reached through a link that leaves the root', () => {
    const x = world();
    fs.symlinkSync(outside, path.join(x.root, 'linked'), 'junction');
    expect(() => {
      syncAll(
        x.settings({
          files: [{ source: 'linked/secret.md', target: 'a.md' }],
        }),
        x.deps,
      );
    }).toThrow(
      'github-sync-files: files[].source linked/secret.md resolves outside the instance root',
    );
    expect(x.calls()).toEqual([]);
  });
});

describe('reading the current file', () => {
  it.each([
    ['a 403', 'gh: Resource not accessible by integration (HTTP 403)'],
    ['a rate limit', 'gh: API rate limit exceeded (HTTP 403)'],
    ['a 5xx', 'gh: Server Error (HTTP 502)'],
  ])('fails the repo on %s, never writing it blind', (_what, error) => {
    const x = world((c) =>
      c.includes(`${ORG}/stale/contents/${TARGET}?ref=main`)
        ? fail(error)
        : undefined,
    );
    expect(() => {
      syncAll(x.settings(), x.deps);
    }).toThrow(`${ORG}/stale: cannot read ${TARGET} in ${ORG}/stale: ${error}`);
    expect(x.writes().some((c) => c.includes(`${ORG}/stale/`))).toBe(false);
    // The other repos still ran.
    expect(x.writes().some((c) => c.includes(`${ACCOUNT}/new/contents`))).toBe(
      true,
    );
    expect(x.runner.state.has(LAST_RUN)).toBe(false);
    expect(console.log).toHaveBeenCalledWith(
      `  [repo] failed for ${ORG}/stale: cannot read ${TARGET} in ${ORG}/stale: ${error}`,
    );
  });

  it('treats a 404 as missing and creates the file', () => {
    const x = world();
    syncAll(x.settings({ live: false }), x.deps);
    expect(console.log).toHaveBeenCalledWith(
      `  [file] would create ${TARGET} in ${ACCOUNT}/new`,
    );
  });

  it('skips an unchanged file over 1 MB, which GitHub returns without content', () => {
    const big = Buffer.alloc(1_500_000, 'x');
    const x = world((c) =>
      c.includes('/contents/big.txt?ref=main')
        ? { sha: gitBlobSha(big), content: '', encoding: 'none' }
        : undefined,
    );
    fs.writeFileSync(path.join(x.root, 'big.txt'), big);
    syncAll(
      x.settings({
        files: [{ source: 'big.txt', target: 'big.txt' }],
        owners: [{ owner: ORG, type: 'org' }],
        ruleset: undefined,
      }),
      x.deps,
    );
    expect(x.writes()).toEqual([]);
    expect(x.runner.state.has(LAST_RUN)).toBe(true);
  });
});
