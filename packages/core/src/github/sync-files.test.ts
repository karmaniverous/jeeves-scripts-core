/**
 * Tests for `github-sync-files` over a fake `gh`: a live run creates the
 * missing ruleset and creates, updates or skips the file per repo
 * (archived repos left out, the ruleset only where the owner wants it),
 * byte-for-byte, as the account, then switches back to the login active
 * before and records `last-run`; without `--live` nothing is written; an
 * existing ruleset, an unavailable Rulesets API, paged listings,
 * include/exclude globs, the default account and a repeat run are
 * handled. Failures are in sync-files.failures.test.ts.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { gitBlobSha } from './lib/file-sync.js';
import {
  ACCOUNT,
  b64,
  BOT,
  CONTENT,
  fail,
  missing,
  OPERATOR,
  ORG,
  repo,
  RULESET,
  SOURCE,
  type SyncFilesWorld,
  TARGET,
  useSyncFilesWorld,
} from './lib/file-sync-gh.test-helper.js';
import { GH_NOW } from './lib/github-deps.test-helper.js';
import { syncAll } from './sync-files.js';

const world = useSyncFilesWorld();

const lastRun = (x: SyncFilesWorld) =>
  x.runner.state.get('github-sync-files|last-run');

describe('github-sync-files', () => {
  it('creates the missing ruleset and syncs the file on a live run', () => {
    const x = world();
    syncAll(x.settings(), x.deps);
    expect(x.writes()).toEqual([
      expect.stringMatching(
        new RegExp(`^api /repos/${ACCOUNT}/new/rulesets -X POST --input `),
      ),
      expect.stringMatching(
        new RegExp(
          `^api /repos/${ACCOUNT}/new/contents/\\.github/copilot-instructions\\.md -X PUT `,
        ),
      ),
      expect.stringMatching(
        new RegExp(`^api /repos/${ORG}/stale/contents/.* -X PUT `),
      ),
    ]);
    expect(x.payloads).toEqual([
      RULESET,
      {
        message: `chore: add ${TARGET}`,
        content: b64(CONTENT),
        branch: 'main',
      },
      {
        message: `chore: update ${TARGET}`,
        content: b64(CONTENT),
        branch: 'main',
        sha: 's2',
      },
    ]);
    expect(x.calls().some((c) => c.includes(`${ACCOUNT}/old`))).toBe(false);
    expect(x.calls().some((c) => c.includes(`${ORG}/same/rulesets`))).toBe(
      false,
    );
    expect(console.log).toHaveBeenCalledWith(
      '[github-sync-files] done: rulesets created=1 failed=0 files created=1 updated=1 skipped=1 protected=0 failed=0',
    );
    expect(console.log).toHaveBeenCalledWith(
      `  [file] updated ${TARGET} in ${ORG}/stale`,
    );
    const switches = x.calls().filter((c) => c.startsWith('auth switch'));
    expect(switches).toEqual([
      `auth switch -u ${ACCOUNT}`,
      `auth switch -u ${OPERATOR}`,
    ]);
    expect(x.calls().at(-1)).toBe(`auth switch -u ${OPERATOR}`);
    expect(lastRun(x)).toBe(GH_NOW);
    expect(x.runner.closed()).toBe(true);
  });

  it('hands each payload to gh in its own temp dir and removes it after the call', () => {
    const x = world((c) =>
      c.includes(' -X PUT ') ? fail('gh: Server Error (HTTP 502)') : undefined,
    );
    expect(() => {
      syncAll(x.settings(), x.deps);
    }).toThrow(/write failed/);
    // A ruleset POST and two PUTs (both failed): three files, three dirs.
    expect(x.inputs).toHaveLength(3);
    const dirs = x.inputs.map((f) => path.dirname(f));
    expect(new Set(dirs).size).toBe(3);
    for (const dir of dirs) expect(fs.existsSync(dir)).toBe(false);
  });

  it('writes nothing without --live and logs what it would do', () => {
    const x = world();
    syncAll(x.settings({ live: false }), x.deps);
    expect(x.writes()).toEqual([]);
    expect(console.log).toHaveBeenCalledWith(
      '[github-sync-files] DRY RUN: pass --live to write',
    );
    expect(console.log).toHaveBeenCalledWith(
      `  [ruleset] would create for ${ACCOUNT}/new`,
    );
    expect(console.log).toHaveBeenCalledWith(
      `  [file] would update ${TARGET} in ${ORG}/stale`,
    );
    expect(console.log).toHaveBeenCalledWith(
      `  [file] would create ${TARGET} in ${ACCOUNT}/new`,
    );
  });

  it('compares by git blob SHA: a binary file that matches is skipped, one that differs is written', () => {
    const bytes = Buffer.from([0, 255, 10, 13, 128]);
    const x = world((call) =>
      call.includes('/contents/logo.bin?ref=main')
        ? {
            sha: gitBlobSha(
              call.includes('same')
                ? bytes
                : // Differs only in bytes that decode to the same text.
                  Buffer.from([0, 254, 10, 13, 128]),
            ),
          }
        : undefined,
    );
    fs.writeFileSync(path.join(x.root, 'logo.bin'), bytes);
    const files = [{ source: 'logo.bin', target: 'logo.bin' }];
    const owners = [{ owner: ORG, type: 'org' as const }];
    syncAll(x.settings({ files, owners, ruleset: undefined }), x.deps);
    expect(x.writes()).toEqual([
      expect.stringMatching(
        /^api \/repos\/example-org\/stale\/contents\/logo\.bin -X PUT /,
      ),
    ]);
    expect(x.payloads[0]).toMatchObject({
      content: b64(bytes),
      sha: gitBlobSha(Buffer.from([0, 254, 10, 13, 128])),
    });
  });

  it('syncs every configured file, each to its own target', () => {
    const x = world();
    fs.writeFileSync(path.join(x.root, 'AGENTS.md'), 'agents\n');
    syncAll(
      x.settings({
        files: [
          { source: SOURCE, target: TARGET },
          { source: 'AGENTS.md', target: 'AGENTS.md' },
        ],
        owners: [{ owner: ORG, type: 'org' }],
        ruleset: undefined,
      }),
      x.deps,
    );
    expect(x.writes().map((c) => c.split(' ')[1])).toEqual([
      `/repos/${ORG}/same/contents/AGENTS.md`,
      `/repos/${ORG}/stale/contents/.github/copilot-instructions.md`,
      `/repos/${ORG}/stale/contents/AGENTS.md`,
    ]);
    expect(console.log).toHaveBeenCalledWith(
      '[github-sync-files] done: rulesets created=0 failed=0 files created=2 updated=1 skipped=1 protected=0 failed=0',
    );
  });

  it('skips the ruleset when the Rulesets API is unavailable', () => {
    const x = world((c) =>
      c === `api /repos/${ACCOUNT}/new/rulesets` ? missing() : undefined,
    );
    syncAll(x.settings(), x.deps);
    expect(console.log).toHaveBeenCalledWith(
      `  [ruleset] skip ${ACCOUNT}/new: rulesets API unavailable`,
    );
    expect(x.writes().some((c) => c.includes('rulesets'))).toBe(false);
    expect(lastRun(x)).toBe(GH_NOW);
  });

  it('treats an existing ruleset of the same name as present', () => {
    const x = world((c) =>
      c === `api /repos/${ACCOUNT}/new/rulesets`
        ? [{ name: 'other' }, { name: RULESET.name }]
        : undefined,
    );
    syncAll(x.settings(), x.deps);
    expect(x.writes().some((c) => c.includes('rulesets'))).toBe(false);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/done: rulesets created=0 failed=0 /),
    );
  });

  it('creates the ruleset when the rulesets listing is empty output', () => {
    const x = world((c) =>
      c === `api /repos/${ACCOUNT}/new/rulesets` ? '' : undefined,
    );
    syncAll(x.settings(), x.deps);
    expect(console.log).toHaveBeenCalledWith(
      `  [ruleset] created for ${ACCOUNT}/new`,
    );
  });

  it('applies no ruleset when none is configured', () => {
    const x = world();
    syncAll(x.settings({ ruleset: undefined }), x.deps);
    expect(x.calls().some((c) => c.includes('rulesets'))).toBe(false);
  });

  it('follows full pages of repos and stops on a short one', () => {
    const page = Array.from({ length: 100 }, (_, i) =>
      repo(`${ORG}/r${String(i)}`, true),
    );
    const x = world((c) => {
      if (!c.includes(`/orgs/${ORG}/repos`)) return undefined;
      if (c.endsWith('&page=1') || c.endsWith('&page=2')) return page;
      return [repo(`${ORG}/last`, true)];
    });
    syncAll(x.settings(), x.deps);
    expect(x.calls().filter((c) => c.includes(`/orgs/${ORG}/repos`))).toEqual(
      [1, 2, 3].map(
        (n) =>
          `api -X GET /orgs/${ORG}/repos?per_page=100&sort=updated&direction=desc&page=${String(n)}`,
      ),
    );
    expect(console.log).toHaveBeenCalledWith(
      `[github-sync-files] ${ORG}: 0 repos`,
    );
  });

  it('narrows the repos by include and exclude globs on full_name', () => {
    const x = world((c) =>
      c.includes(`/orgs/${ORG}/repos`)
        ? [
            repo(`${ORG}/web-app`),
            repo(`${ORG}/web-legacy`),
            repo(`${ORG}/API`),
            repo(`${ORG}/docs`),
          ]
        : undefined,
    );
    syncAll(
      x.settings({
        owners: [
          {
            owner: ORG,
            type: 'org',
            include: [`${ORG}/web-*`, `${ORG}/api`],
            exclude: ['*/*-legacy'],
          },
        ],
        ruleset: undefined,
      }),
      x.deps,
    );
    expect(console.log).toHaveBeenCalledWith(
      `[github-sync-files] ${ORG}: 2 repos`,
    );
    const touched = new Set(
      x
        .calls()
        .filter((c) => c.includes('/contents/'))
        .map((c) => c.split('/')[3]),
    );
    expect([...touched]).toEqual(['web-app', 'API']);
  });

  it('acts as integrations.gh.botUser when no account is configured', () => {
    const x = world((c) =>
      c.includes('/user/repos') ? [repo(`${BOT}/tools`)] : undefined,
    );
    syncAll(
      x.settings({
        account: undefined,
        owners: [{ owner: BOT, type: 'user' }],
      }),
      x.deps,
    );
    expect(x.calls()[1]).toBe(`auth switch -u ${BOT}`);
    expect(x.writes()).toHaveLength(2);
    expect(x.calls().at(-1)).toBe(`auth switch -u ${OPERATOR}`);
  });

  it('writes nothing on a repeat run with no upstream change and still records last-run', () => {
    const x = world((c) => {
      if (c === `api /repos/${ACCOUNT}/new/rulesets`) return [RULESET];
      if (c.includes(`contents/${TARGET}?ref=main`))
        return { sha: gitBlobSha(Buffer.from(CONTENT)), content: b64(CONTENT) };
      return undefined;
    });
    syncAll(x.settings(), x.deps);
    expect(x.writes()).toEqual([]);
    expect(console.log).toHaveBeenCalledWith(
      '[github-sync-files] done: rulesets created=0 failed=0 files created=0 updated=0 skipped=3 protected=0 failed=0',
    );
    expect(lastRun(x)).toBe(GH_NOW);
  });
});
