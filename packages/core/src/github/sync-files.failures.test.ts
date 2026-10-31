/**
 * Failure tests for `github-sync-files` over a fake `gh`: a branch that
 * requires a pull request counts `protected`, not failed; a failed write,
 * a refused ruleset, a repo whose calls throw and a failed or malformed
 * listing are logged and counted, every other repo is still attempted,
 * and the run then fails naming every failure, without `last-run`. The
 * acting-account check stops the run before any listing or write. On
 * every exit path `gh` is switched back to the login active before the
 * run and the runner client is closed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACCOUNT,
  fail,
  OPERATOR,
  ORG,
  type SyncFilesWorld,
  syncFilesWorld,
  TARGET,
} from './lib/file-sync-gh.test-helper.js';
import { GhAccountMismatchError } from './lib/github-deps.js';
import { syncAll } from './sync-files.js';

let w: SyncFilesWorld | undefined;
const world = (override?: Parameters<typeof syncFilesWorld>[0]) =>
  (w = syncFilesWorld(override));

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  w?.cleanup();
  w = undefined;
  vi.restoreAllMocks();
});

const LOGIN = 'api user --jq .login';

/** Switched to the account once, back to the operator last, client closed. */
const expectRestored = (x: SyncFilesWorld) => {
  expect(
    x.calls().filter((c) => c === `auth switch -u ${ACCOUNT}`),
  ).toHaveLength(1);
  expect(x.calls().at(-1)).toBe(`auth switch -u ${OPERATOR}`);
  expect(x.runner.closed()).toBe(true);
};

/** The run failed after trying everything, and left last-run and auth right. */
const expectFailedRun = (x: SyncFilesWorld, message: string | RegExp) => {
  expect(() => {
    syncAll(x.settings(), x.deps);
  }).toThrow(message);
  expect(x.runner.state.has('github-sync-files|last-run')).toBe(false);
  expectRestored(x);
};

describe('github-sync-files failures', () => {
  it('counts a branch that requires a pull request as protected, not a failure', () => {
    const x = world((c) =>
      c.includes(`${ORG}/stale/contents/`) && c.includes(' -X PUT ')
        ? fail('gh: Changes must be made through a pull request. (HTTP 409)')
        : undefined,
    );
    syncAll(x.settings(), x.deps);
    expect(x.runner.state.has('github-sync-files|last-run')).toBe(true);
    expect(console.log).toHaveBeenCalledWith(
      `  [file] skip ${TARGET} in ${ORG}/stale: main requires a pull request (HTTP 409)`,
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(
        /files created=1 updated=0 skipped=1 protected=1 failed=0$/,
      ),
    );
    expectRestored(x);
  });

  it('counts failed writes, attempts every repo, then fails', () => {
    const x = world((c) =>
      c.includes(' -X PUT ') ? fail('HTTP 409') : undefined,
    );
    expectFailedRun(
      x,
      `github-sync-files: 2 failure(s); last-run not recorded: ${ACCOUNT}/new: ${TARGET} write failed; ${ORG}/stale: ${TARGET} write failed`,
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(
        /files created=0 updated=0 skipped=1 protected=0 failed=2$/,
      ),
    );
    expect(console.log).toHaveBeenCalledWith(
      `  [file] failed for ${TARGET} in ${ORG}/stale: HTTP 409`,
    );
  });

  it('counts a refused ruleset create and still syncs the file', () => {
    const x = world((c) =>
      c.startsWith(`api /repos/${ACCOUNT}/new/rulesets -X POST`)
        ? fail('Validation Failed')
        : undefined,
    );
    expectFailedRun(x, `${ACCOUNT}/new: ruleset create failed`);
    expect(console.log).toHaveBeenCalledWith(
      `  [ruleset] failed for ${ACCOUNT}/new: Validation Failed`,
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/done: rulesets created=0 failed=1 /),
    );
    expect(x.writes()).toHaveLength(3);
  });

  it('records a repo whose calls throw and goes on to the next', () => {
    const x = world((c) => {
      if (c.includes(`${ORG}/same/contents`)) throw new Error('gh: 500');
      return undefined;
    });
    expectFailedRun(x, `${ORG}/same: gh: 500`);
    expect(console.log).toHaveBeenCalledWith(
      `  [repo] failed for ${ORG}/same: gh: 500`,
    );
    expect(
      x
        .calls()
        .some((c) => c.includes(`${ORG}/stale/contents/`) && c.includes('PUT')),
    ).toBe(true);
  });

  it('records a failed repo listing and still syncs the other owner', () => {
    const x = world((c) =>
      c.includes(`/orgs/${ORG}/repos`) ? fail('gh: 502') : undefined,
    );
    expectFailedRun(x, `${ORG} repo listing: gh: 502`);
    expect(console.log).toHaveBeenCalledWith(
      `[github-sync-files] ${ORG}: listing failed: gh: 502`,
    );
    expect(x.writes()).toHaveLength(2);
  });

  it('records a repo listing that is not an array of repos', () => {
    const x = world((c) =>
      c.includes('/user/repos') ? { message: 'Bad credentials' } : undefined,
    );
    expectFailedRun(x, new RegExp(`${ACCOUNT} repo listing: `));
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`^\\[github-sync-files\\] ${ACCOUNT}: listing failed: `),
      ),
    );
  });

  it("records a 'user' owner that is not the acting account, without listing it", () => {
    const x = world();
    expect(() => {
      syncAll(
        x.settings({ owners: [{ owner: 'someone-else', type: 'user' }] }),
        x.deps,
      );
    }).toThrow(
      `someone-else repo listing: a 'user' owner must be the acting account (${ACCOUNT})`,
    );
    expect(x.calls().some((c) => c.includes('/user/repos'))).toBe(false);
    expectRestored(x);
  });

  it('fails before any listing or write when gh acts as another login, and still restores auth', () => {
    const x = world();
    const gh = x.deps.gh;
    let switched = false;
    x.deps.gh = (args, options) => {
      if (args[0] === 'auth') switched = args[3] === ACCOUNT;
      if (switched && args.join(' ') === LOGIN) {
        x.ghCalls.push(args);
        return { ok: true, status: 0, out: 'example-intruder', err: '' };
      }
      return gh(args, options);
    };
    expect(() => {
      syncAll(x.settings(), x.deps);
    }).toThrow(
      new GhAccountMismatchError(
        `github-sync-files: acting gh login is "example-intruder", expected "${ACCOUNT}"; not writing to any repo`,
      ),
    );
    expect(x.calls()).toEqual([
      LOGIN,
      `auth switch -u ${ACCOUNT}`,
      LOGIN,
      `auth switch -u ${OPERATOR}`,
    ]);
    expect(x.runner.state.size).toBe(0);
    expect(x.runner.closed()).toBe(true);
  });

  it('fails when the acting login cannot be read after the switch, and still restores auth', () => {
    const x = world();
    const gh = x.deps.gh;
    let switched = false;
    x.deps.gh = (args, options) => {
      if (args[0] === 'auth') switched = args[3] === ACCOUNT;
      if (switched && args.join(' ') === LOGIN)
        throw new Error('bad credentials');
      return gh(args, options);
    };
    expect(() => {
      syncAll(x.settings(), x.deps);
    }).toThrow(/not writing to any repo/);
    expect(x.calls().at(-1)).toBe(`auth switch -u ${OPERATOR}`);
  });

  it('does not switch at all when the active login cannot be read', () => {
    const x = world();
    x.pinLogin(new Error('no login'));
    expect(() => {
      syncAll(x.settings(), x.deps);
    }).toThrow(
      'github-sync-files: cannot read the active gh login; not switching: no login',
    );
    expect(x.calls()).toEqual([LOGIN]);
  });

  it('treats an empty active login as unreadable', () => {
    const x = world();
    x.pinLogin('');
    expect(() => {
      syncAll(x.settings(), x.deps);
    }).toThrow(/cannot read the active gh login; not switching: empty login/);
  });

  it('fails when the switch itself fails, and still tries to restore auth', () => {
    const x = world();
    const gh = x.deps.gh;
    x.deps.gh = (args, options) => {
      if (args.join(' ') === `auth switch -u ${ACCOUNT}`)
        throw new Error('no such login');
      return gh(args, options);
    };
    expect(() => {
      syncAll(x.settings(), x.deps);
    }).toThrow('no such login');
    expect(x.calls().at(-1)).toBe(`auth switch -u ${OPERATOR}`);
    expect(x.runner.closed()).toBe(true);
  });

  it('a failed restore fails an otherwise clean run, and never hides an earlier error', () => {
    const failRestore = (x: SyncFilesWorld) => {
      const gh = x.deps.gh;
      x.deps.gh = (args, options) => {
        if (args.join(' ') === `auth switch -u ${OPERATOR}`)
          throw new Error('restore failed');
        return gh(args, options);
      };
    };
    const clean = world();
    failRestore(clean);
    expect(() => {
      syncAll(clean.settings(), clean.deps);
    }).toThrow('restore failed');
    expect(console.log).toHaveBeenCalledWith(
      `[github-sync-files] could not switch gh back to ${OPERATOR}: restore failed`,
    );
    expect(clean.runner.closed()).toBe(true);
    clean.cleanup();

    const failing = world((c) =>
      c.includes(' -X PUT ') ? fail('HTTP 500') : undefined,
    );
    failRestore(failing);
    expect(() => {
      syncAll(failing.settings(), failing.deps);
    }).toThrow(/2 failure\(s\)/);
    expect(failing.runner.closed()).toBe(true);
  });

  it('refuses to run with no account and no bot user, before any gh call', () => {
    const x = world();
    x.deps.botUser = '';
    expect(() => {
      syncAll(x.settings({ account: undefined }), x.deps);
    }).toThrow(
      "github-sync-files: no account to act as; set jobs['github-sync-files'].account or integrations.gh.botUser",
    );
    expect(x.calls()).toEqual([]);
  });

  it('refuses to run when a source file is missing, before any gh call', () => {
    const x = world();
    expect(() => {
      syncAll(
        x.settings({ files: [{ source: 'nope.md', target: 'nope.md' }] }),
        x.deps,
      );
    }).toThrow(/github-sync-files: cannot read files\[\]\.source .*nope\.md/);
    expect(x.calls()).toEqual([]);
  });
});
