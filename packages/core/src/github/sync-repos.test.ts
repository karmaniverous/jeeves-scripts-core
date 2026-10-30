import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type GitHubWorld,
  githubWorld,
} from './lib/github-deps.test-helper.js';
import { syncRepos } from './sync-repos.js';

let w: GitHubWorld;
let repoDir: string;
let metaDir: string;

/**
 * A mirror of acme/app checked out on `main`; the registry now says `dev`.
 * `git` answers `rev-parse` with `main`; `fail` makes matching calls throw;
 * a clone creates its target directory with a marker file.
 */
const world = (fail: (args: string[]) => boolean = () => false) => {
  w = githubWorld();
  const base = path.join(w.dir, 'content', 'github', 'acme', 'app');
  repoDir = path.join(base, 'repo');
  metaDir = path.join(base, '.meta');
  fs.mkdirSync(repoDir, { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'stale.txt'), 'old');
  fs.mkdirSync(metaDir);
  fs.writeFileSync(path.join(metaDir, 'meta.json'), '{}');
  fs.writeFileSync(
    w.deps.registryPath,
    JSON.stringify({ repos: { 'acme/app': { defaultBranch: 'dev' } } }),
  );
  w.runner.client.setItem(
    'github',
    'repos-sync',
    'acme/app',
    JSON.stringify({ lastSyncedAt: null, defaultBranch: 'main' }),
  );
  const record = w.deps.run;
  w.deps.run = (cmd, args) => {
    record(cmd, args);
    if (fail(args)) throw new Error(`git ${args.join(' ')} failed`);
    if (args.includes('rev-parse')) return 'main\n';
    if (args[0] === 'clone') {
      const dir = args.at(-1) ?? '';
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'fresh.txt'), args.join(' '));
    }
    return '';
  };
};
const git = () =>
  w.runCalls.filter((c) => c[0] === 'git').map((c) => c.slice(1).join(' '));
const stored = () =>
  JSON.parse(
    w.runner.items.get('github|repos-sync')?.get('acme/app') ?? '{}',
  ) as Record<string, unknown>;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  w.cleanup();
});

describe('syncRepos when the default branch changed (#48)', () => {
  it('switches the refspec and fetches the new branch into origin/<branch>', () => {
    world();
    syncRepos(w.deps);
    expect(git()).toEqual([
      `-C ${repoDir} remote set-url origin https://github.com/acme/app.git`,
      `-C ${repoDir} rev-parse --abbrev-ref HEAD`,
      `-C ${repoDir} remote set-branches origin dev`,
      `-C ${repoDir} fetch --depth 1 origin +refs/heads/dev:refs/remotes/origin/dev`,
      `-C ${repoDir} checkout -B dev origin/dev`,
      `-C ${repoDir} reset --hard origin/dev`,
      `-C ${repoDir} clean -fdx`,
    ]);
    expect(stored()).toEqual({
      lastSyncedAt: w.deps.now(),
      defaultBranch: 'dev',
    });
  });

  it('leaves the refspec alone when the branch is unchanged', () => {
    world();
    fs.writeFileSync(
      w.deps.registryPath,
      JSON.stringify({ repos: { 'acme/app': { defaultBranch: 'main' } } }),
    );
    syncRepos(w.deps);
    expect(git().some((c) => c.includes('set-branches'))).toBe(false);
  });

  it('clones afresh beside the mirror and swaps it in when the update fails, keeping .meta/', () => {
    world((args) => args.includes('checkout'));
    syncRepos(w.deps);
    expect(git().at(-1)).toBe(
      `clone --depth 1 --branch dev https://github.com/acme/app.git ${repoDir}.fresh`,
    );
    expect(fs.existsSync(path.join(repoDir, 'fresh.txt'))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, 'stale.txt'))).toBe(false);
    expect(fs.existsSync(`${repoDir}.fresh`)).toBe(false);
    expect(fs.existsSync(`${repoDir}.old`)).toBe(false);
    expect(fs.readFileSync(path.join(metaDir, 'meta.json'), 'utf8')).toBe('{}');
    expect(stored()).not.toHaveProperty('lastError');
  });

  it('keeps the old mirror, records the error and fails the run when the fresh clone fails too', () => {
    world((args) => args.includes('checkout') || args[0] === 'clone');
    expect(() => {
      syncRepos(w.deps);
    }).toThrow('[repo-sync] 1 of 1 repos failed to sync');
    expect(fs.existsSync(path.join(repoDir, 'stale.txt'))).toBe(true);
    expect(fs.existsSync(`${repoDir}.fresh`)).toBe(false);
    expect(stored()).toMatchObject({
      defaultBranch: 'dev',
      lastError: expect.stringContaining('clone') as unknown,
    });
  });

  it('puts the old mirror back when the fresh one cannot be moved into place (#61 review)', () => {
    world((args) => args.includes('checkout'));
    const rename = fs.renameSync.bind(fs);
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(from).endsWith('.fresh')) throw new Error('EPERM: locked');
      rename(from, to);
    });
    expect(() => {
      syncRepos(w.deps);
    }).toThrow('[repo-sync] 1 of 1 repos failed to sync');
    expect(fs.existsSync(path.join(repoDir, 'stale.txt'))).toBe(true);
    expect(fs.existsSync(`${repoDir}.old`)).toBe(false);
    expect(fs.existsSync(`${repoDir}.fresh`)).toBe(false);
    expect(stored()).toMatchObject({
      lastError: expect.stringContaining('EPERM') as unknown,
    });
  });

  it('counts the sync done when only removing the old copy fails', () => {
    world((args) => args.includes('checkout'));
    const rm = fs.rmSync.bind(fs);
    vi.spyOn(fs, 'rmSync').mockImplementation((target, options) => {
      if (String(target).endsWith('.old') && fs.existsSync(target))
        throw new Error('EBUSY: open');
      rm(target, options);
    });
    syncRepos(w.deps);
    expect(fs.existsSync(path.join(repoDir, 'fresh.txt'))).toBe(true);
    expect(stored()).not.toHaveProperty('lastError');
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('warning: could not remove') as unknown,
    );
  });

  it('leaves no fresh copy when the old mirror cannot be moved aside (second review)', () => {
    world((args) => args.includes('checkout'));
    const rename = fs.renameSync.bind(fs);
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(to).endsWith('.old')) throw new Error('EBUSY: open handle');
      rename(from, to);
    });
    expect(() => {
      syncRepos(w.deps);
    }).toThrow('[repo-sync] 1 of 1 repos failed to sync');
    expect(fs.existsSync(path.join(repoDir, 'stale.txt'))).toBe(true);
    expect(fs.existsSync(repoDir + '.fresh')).toBe(false);
    expect(stored()).toMatchObject({
      lastError: expect.stringContaining('EBUSY') as unknown,
    });
  });

  it('records the swap error, not a failing rollback step', () => {
    world((args) => args.includes('checkout'));
    const rename = fs.renameSync.bind(fs);
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(from).endsWith('.fresh')) throw new Error('EPERM: swap');
      if (String(from).endsWith('.old')) throw new Error('EPERM: rollback');
      rename(from, to);
    });
    expect(() => {
      syncRepos(w.deps);
    }).toThrow();
    expect(stored()).toMatchObject({
      lastError: expect.stringContaining('EPERM: swap') as unknown,
    });
  });

  it('clears copies an earlier reclone left behind on a normal sync', () => {
    world();
    for (const suffix of ['.old', '.fresh']) {
      fs.mkdirSync(repoDir + suffix);
      fs.writeFileSync(path.join(repoDir + suffix, 'x.txt'), 'x');
    }
    syncRepos(w.deps);
    expect(fs.existsSync(repoDir + '.old')).toBe(false);
    expect(fs.existsSync(repoDir + '.fresh')).toBe(false);
    expect(fs.existsSync(path.join(repoDir, 'stale.txt'))).toBe(true);
  });
});
