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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { gitBlobSha } from './lib/file-sync.js';
import {
  ACCOUNT,
  fail,
  interceptGh,
  ORG,
  TARGET,
  useSyncFilesWorld,
} from './lib/file-sync-gh.test-helper.js';
import { syncAll } from './sync-files.js';

const world = useSyncFilesWorld();
let outside: string;

beforeEach(() => {
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-files-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.md'), 'host secret');
});
afterEach(() => {
  fs.rmSync(outside, { recursive: true, force: true });
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

  it('treats a 404 as missing, on stderr or (with stderr empty) stdout, and creates the file without a sha', () => {
    const x = world();
    interceptGh(x, (args) =>
      args.join(' ').includes(`${ORG}/stale/contents/${TARGET}?ref=main`)
        ? { ok: false, status: 1, out: 'gh: Not Found (HTTP 404)', err: '' }
        : undefined,
    );
    syncAll(x.settings({ ruleset: undefined }), x.deps);
    // `${ACCOUNT}/new` gets the 404 on stderr (the fake's default).
    expect(x.writes()).toEqual([
      expect.stringContaining(`${ACCOUNT}/new/contents/`),
      expect.stringContaining(`${ORG}/stale/contents/`),
    ]);
    expect(x.payloads.map((p) => ({ message: p.message, sha: p.sha }))).toEqual(
      [
        { message: `chore: add ${TARGET}`, sha: undefined },
        { message: `chore: add ${TARGET}`, sha: undefined },
      ],
    );
    expect(x.runner.state.has(LAST_RUN)).toBe(true);
  });

  it('fails the repo on a read that fails with no output at all', () => {
    const x = world();
    interceptGh(x, (args) =>
      args.join(' ').includes(`${ORG}/stale/contents/${TARGET}?ref=main`)
        ? { ok: false, status: 1, out: '', err: '' }
        : undefined,
    );
    expect(() => {
      syncAll(x.settings(), x.deps);
    }).toThrow(
      `${ORG}/stale: cannot read ${TARGET} in ${ORG}/stale: gh api failed`,
    );
    expect(x.writes().some((c) => c.includes(`${ORG}/stale/`))).toBe(false);
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

describe('listing repos', () => {
  it('counts an owner whose listing prints nothing as having no repos, not as a failure', () => {
    const x = world((c) => (c.includes(`/orgs/${ORG}/repos`) ? '' : undefined));
    syncAll(x.settings(), x.deps);
    expect(console.log).toHaveBeenCalledWith(
      `[github-sync-files] ${ORG}: 0 repos`,
    );
    expect(x.calls().filter((c) => c.includes(`/orgs/${ORG}/repos`))).toEqual([
      `api -X GET /orgs/${ORG}/repos?per_page=100&sort=updated&direction=desc&page=1`,
    ]);
    expect(x.runner.state.has(LAST_RUN)).toBe(true);
  });
});
