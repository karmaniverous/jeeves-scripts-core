import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fakeGitHub, issue, pr, release } from '../punch-list.test-helper.js';
import { gatherFacts } from './facts.js';
import {
  checkInstall,
  installedLine,
  liveInstallEnv,
  parseTag,
  versionAtLeast,
} from './install.js';

describe('install', () => {
  it('parses tags and compares versions', () => {
    expect(parseTag('service/3.16.0')).toEqual({
      component: 'service',
      version: '3.16.0',
    });
    expect(parseTag('v0.7.0')).toEqual({ component: '', version: '0.7.0' });
    expect(versionAtLeast('3.16.1', '3.16.0')).toBe(true);
    expect(versionAtLeast('3.15.9', '3.16.0')).toBe(false);
    expect(versionAtLeast('3.16.0', '3.16.0')).toBe(true);
  });

  it('checks releases against the install map and PRs against the clone', () => {
    const port = fakeGitHub(
      {
        'acme/s': [issue(3, 'closed')],
        'k/server': [issue(41, 'closed')],
        'k/other': [issue(9, 'closed')],
      },
      { 3: [pr(7, 'aaa')], 41: [pr(50, 'bbb')], 9: [pr(60, 'ccc')] },
      {
        'k/server': [{ release: release('service/3.16.0'), shas: ['bbb'] }],
        'k/other': [{ release: release('1.0.0'), shas: ['ccc'] }],
      },
    );
    const facts = gatherFacts(
      port,
      'acme-x',
      ['acme/s', 'k/server', 'k/other'],
      'acme/s',
    );
    const env = { versionsAt: () => ['3.15.0'], inHead: () => true };
    const checks = checkInstall(
      facts,
      { 'k/server': [{ component: 'service', packageJson: 'x' }] },
      '/clone',
      env,
    );
    expect(checks.map((c) => c.state)).toEqual([
      'installed',
      'pending',
      'unmapped',
    ]);
    expect(installedLine(checks)).toBe(
      '- Installed: ⏳ awaiting operator update: server service/3.16.0 (installed 3.15.0) · other 1.0.0 ❔ not in the install map',
    );
    const ok = checkInstall(
      facts,
      {
        'k/server': [{ component: 'service', packageJson: 'x' }],
        'k/other': [{ component: '', packageJson: 'y' }],
      },
      '/clone',
      {
        versionsAt: () => ['3.16.0', '1.0.0'],
        inHead: () => true,
      },
    );
    expect(installedLine(ok)).toBe('- Installed: ✅');
  });
});

describe('liveInstallEnv', () => {
  it('reads every package.json version matching a glob', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pl-install-'));
    const installs: [string, string][] = [
      ['aaa', '0.15.0'],
      ['bbb', '0.16.0'],
    ];
    for (const [hash, version] of installs) {
      mkdirSync(join(dir, `proj-${hash}`), { recursive: true });
      writeFileSync(
        join(dir, `proj-${hash}`, 'package.json'),
        JSON.stringify({ version }),
      );
    }
    expect(
      liveInstallEnv.versionsAt(join(dir, 'proj-*', 'package.json')).sort(),
    ).toEqual(['0.15.0', '0.16.0']);
    expect(
      liveInstallEnv.versionsAt(join(dir, 'none-*', 'package.json')),
    ).toEqual([]);
  });

  it('knows whether a commit is in a clone’s HEAD', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pl-git-'));
    const git = (...args: string[]): string =>
      execFileSync(
        'git',
        ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args],
        { encoding: 'utf8' },
      ).trim();
    git('init', '-q', '-b', 'main');
    git('commit', '-q', '--allow-empty', '-m', 'one');
    const first = git('rev-parse', 'HEAD');
    git('checkout', '-q', '-b', 'side');
    git('commit', '-q', '--allow-empty', '-m', 'two');
    const second = git('rev-parse', 'HEAD');
    git('checkout', '-q', 'main');
    expect(liveInstallEnv.inHead(dir, first)).toBe(true);
    expect(liveInstallEnv.inHead(dir, second)).toBe(false);
  });
});

describe('install edge cases', () => {
  it('compares versions with missing parts as zero', () => {
    expect(versionAtLeast('3.16', '3.16.0')).toBe(true);
    expect(versionAtLeast('3.16.0', '3.16.1')).toBe(false);
    expect(versionAtLeast('4', '3.99.99')).toBe(true);
  });

  it('reports a mapped release with no installed package as not installed', () => {
    const port = fakeGitHub(
      { 'k/server': [issue(41, 'closed')] },
      { 41: [pr(50, 'bbb')] },
      { 'k/server': [{ release: release('service/3.16.0'), shas: ['bbb'] }] },
    );
    const facts = gatherFacts(port, 'acme-x', ['acme/s', 'k/server'], 'acme/s');
    const checks = checkInstall(
      facts,
      { 'k/server': [{ component: 'service', packageJson: 'x' }] },
      '/clone',
      { versionsAt: () => [], inHead: () => false },
    );
    expect(checks).toEqual([
      {
        label: 'server service/3.16.0',
        state: 'pending',
        detail: 'not installed',
      },
    ]);
  });

  it('says nothing is released when there is nothing to check', () => {
    expect(installedLine([])).toMatch(
      /awaiting operator update: nothing released$/,
    );
  });
});
