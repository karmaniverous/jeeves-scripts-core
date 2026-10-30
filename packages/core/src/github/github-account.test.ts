import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildRegistry } from './build-registry.js';
import { drainCollabs } from './drain-collabs.js';
import {
  GhAccountMismatchError,
  type GitHubJobDeps,
  verifyActingAccount,
} from './lib/github-deps.js';
import {
  type GitHubWorld,
  githubWorld,
} from './lib/github-deps.test-helper.js';
import { pollCollabs } from './poll-collabs.js';
import { syncIssues } from './sync-issues.js';
import { syncRepos } from './sync-repos.js';
import { watchNotifications } from './watch.js';

let w: GitHubWorld | undefined;
afterEach(() => {
  w?.cleanup();
  w = undefined;
  vi.restoreAllMocks();
});

const LOGIN_CALL = ['api', 'user', '--jq', '.login'];

describe('verifyActingAccount (#59)', () => {
  it.each(['acme', 'ACME'])('passes when gh acts as %s', (login) => {
    w = githubWorld();
    w.pinLogin(login);
    expect(() => {
      verifyActingAccount(w!.deps, 'acme');
    }).not.toThrow();
    expect(w.ghCalls).toEqual([LOGIN_CALL]);
  });

  it('throws on another login', () => {
    w = githubWorld();
    w.pinLogin('jane');
    expect(() => {
      verifyActingAccount(w!.deps, 'acme');
    }).toThrow(
      new GhAccountMismatchError('acting gh login is "jane", expected "acme"'),
    );
  });

  it('throws when the login cannot be read', () => {
    w = githubWorld();
    w.pinLogin(new Error('bad credentials'));
    expect(() => {
      verifyActingAccount(w!.deps, 'acme');
    }).toThrow(/acting gh login unknown, expected "acme": bad credentials/);
  });
});

/** Each job, run against a world; resolves or rejects as the job does. */
const jobs: [string, (deps: GitHubJobDeps) => unknown][] = [
  [
    'github-watch',
    (d) => {
      watchNotifications(d);
    },
  ],
  [
    'github-poll-collabs',
    (d) => {
      pollCollabs({}, d);
    },
  ],
  [
    'github-drain-collabs',
    (d) => {
      drainCollabs({}, d);
    },
  ],
  ['github-sync-issues', (d) => syncIssues(d)],
  [
    'github-build-registry',
    (d) => {
      buildRegistry(d);
    },
  ],
  [
    'github-sync-repos',
    (d) => {
      syncRepos(d);
    },
  ],
];

describe('GitHub jobs stop when gh acts as the wrong account (#59)', () => {
  it.each(jobs)(
    '%s fails after the switch and makes no further gh call',
    async (_id, job) => {
      w = githubWorld(() => []);
      w.pinLogin('jane');
      w.runner.client.enqueue('gh-collabs', {
        kind: 'repo',
        full_name: 'acme/a',
      });
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      await expect(
        (async () => {
          await job(w.deps);
        })(),
      ).rejects.toThrow(GhAccountMismatchError);
      expect(w.ghCalls.filter((c) => c[0] !== 'auth')).toEqual([LOGIN_CALL]);
    },
  );

  it('github-drain-collabs fails the item it was on', () => {
    w = githubWorld(() => []);
    w.pinLogin('jane');
    w.runner.client.enqueue('gh-collabs', {
      kind: 'repo',
      full_name: 'acme/a',
    });
    expect(() => {
      drainCollabs({}, w!.deps);
    }).toThrow(GhAccountMismatchError);
    expect(
      (w.runner.queues.get('gh-collabs') ?? []).map((i) => i.error),
    ).toEqual(['acting gh login is "jane", expected "acme"']);
  });
});
