/**
 * `github-sync-files` matches the instance prototype it was hoisted from
 * (spec 2.8, §5): given the prototype's two owners (the acting user with
 * the ruleset, an org without), its ruleset and one instructions file as
 * config, over the prototype's fake-`gh` fixture (neutral names), it makes
 * the same GitHub calls in the same order and logs the same counts in the
 * same summary-line shape, live, dry and with a pull-request-only branch.
 * The expected values are the prototype's own test expectations.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  ACCOUNT,
  fail,
  ORG,
  type SyncFilesWorld,
  useSyncFilesWorld,
} from './lib/file-sync-gh.test-helper.js';
import { syncAll } from './sync-files.js';

const world = useSyncFilesWorld();

const FILE = '.github/copilot-instructions.md';

/** The prototype's GitHub calls on its fixture (auth calls aside). */
const PROTOTYPE_CALLS = [
  `api -X GET /user/repos?per_page=100&type=owner&sort=updated&direction=desc&page=1`,
  `api /repos/${ACCOUNT}/new/rulesets`,
  `api /repos/${ACCOUNT}/new/rulesets -X POST --input <payload>`,
  `api /repos/${ACCOUNT}/new/contents/${FILE}?ref=main`,
  `api /repos/${ACCOUNT}/new/contents/${FILE} -X PUT --input <payload>`,
  `api -X GET /orgs/${ORG}/repos?per_page=100&sort=updated&direction=desc&page=1`,
  `api /repos/${ORG}/same/contents/${FILE}?ref=main`,
  `api /repos/${ORG}/stale/contents/${FILE}?ref=main`,
  `api /repos/${ORG}/stale/contents/${FILE} -X PUT --input <payload>`,
];

/** The run's GitHub calls, auth calls aside, payload paths elided. */
const githubCalls = (x: SyncFilesWorld) =>
  x
    .calls()
    .filter((c) => !c.startsWith('auth ') && c !== 'api user --jq .login')
    .map((c) => c.replace(/--input .*$/, '--input <payload>'));

/** The summary line in the prototype's words. */
const asPrototype = (line: string) =>
  line
    .replace('[github-sync-files]', '[copilot-review-sync]')
    .replace(' files created=', ' instructions created=');

const summary = () =>
  vi
    .mocked(console.log)
    .mock.calls.map(([line]) => String(line))
    .filter((line) => line.includes('] done: '))
    .map(asPrototype);

describe('github-sync-files matches the prototype on the same input', () => {
  it('live run: same calls, same counts', () => {
    const w = world();
    syncAll(w.settings(), w.deps);
    expect(githubCalls(w)).toEqual(PROTOTYPE_CALLS);
    expect(summary()).toEqual([
      '[copilot-review-sync] done: rulesets created=1 failed=0 instructions created=1 updated=1 skipped=1 protected=0 failed=0',
    ]);
  });

  it('dry run: the same reads, no writes, the same counts', () => {
    const w = world();
    syncAll(w.settings({ live: false }), w.deps);
    expect(githubCalls(w)).toEqual(
      PROTOTYPE_CALLS.filter((c) => !/ -X (POST|PUT) /.test(c)),
    );
    expect(summary()).toEqual([
      '[copilot-review-sync] done: rulesets created=1 failed=0 instructions created=1 updated=1 skipped=1 protected=0 failed=0',
    ]);
  });

  it('a pull-request-only branch: protected, as the prototype counts it', () => {
    const w = world((c) =>
      c.includes(`${ORG}/stale/contents/`) && c.includes(' -X PUT ')
        ? fail('gh: Changes must be made through a pull request. (HTTP 409)')
        : undefined,
    );
    syncAll(w.settings(), w.deps);
    expect(summary()).toEqual([
      '[copilot-review-sync] done: rulesets created=1 failed=0 instructions created=1 updated=0 skipped=1 protected=1 failed=0',
    ]);
  });
});
