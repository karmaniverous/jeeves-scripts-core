/** `updateClone` against the real `git`, with local repos as upstreams. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { run } from '@karmaniverous/jeeves';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type CloneDeps, updateClone } from './clone.js';
import { commitAll, git, makeRepo, writeTree } from './library.test-helper.js';

describe('updateClone', () => {
  let root: string;
  let upstream: string;
  let url: string;
  let clone: string;
  const lines: string[] = [];
  const deps: CloneDeps = { run, log: (l) => lines.push(l) };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'library-clone-'));
    upstream = path.join(root, 'upstream');
    url = makeRepo(upstream, { 'docs/a.md': 'one\n' });
    clone = path.join(root, 'state', 'library', 'docs', 'clone');
    lines.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const head = () => git(upstream, 'rev-parse', '--short', 'HEAD');
  const read = (rel: string) => fs.readFileSync(path.join(clone, rel), 'utf8');

  it('clones the ref shallowly when there is no clone, returning the short head', () => {
    writeTree(upstream, { 'docs/a.md': 'two\n' });
    commitAll(upstream, 'second');
    expect(updateClone(deps, url, 'main', clone)).toBe(head());
    expect(read('docs/a.md')).toBe('two\n');
    // Two commits upstream, one in the clone.
    expect(git(clone, 'rev-list', '--count', 'HEAD')).toBe('1');
    expect(lines).toEqual([`CLONE ${url} (main)`]);
  });

  it('updates an existing clone to the new upstream head, dropping local changes', () => {
    updateClone(deps, url, 'main', clone);
    writeTree(upstream, { 'docs/a.md': 'two\n', 'docs/b.md': 'new\n' });
    commitAll(upstream, 'second');
    writeTree(clone, { 'docs/a.md': 'local edit\n', 'stray.md': 'untracked' });
    expect(updateClone(deps, url, 'main', clone)).toBe(head());
    expect(read('docs/a.md')).toBe('two\n');
    expect(read('docs/b.md')).toBe('new\n');
    expect(fs.existsSync(path.join(clone, 'stray.md'))).toBe(false);
    // Updated in place: the first run's clone, no RECLONE.
    expect(lines).toEqual([`CLONE ${url} (main)`]);
  });

  it('tracks a tag', () => {
    git(upstream, 'tag', 'v1');
    expect(updateClone(deps, url, 'v1', clone)).toBe(head());
    writeTree(upstream, { 'docs/a.md': 'two\n' });
    commitAll(upstream, 'second');
    git(upstream, 'tag', '-f', 'v1');
    updateClone(deps, url, 'v1', clone);
    expect(read('docs/a.md')).toBe('two\n');
  });

  it('keeps the repo bytes whatever the host git config says about line endings', () => {
    vi.stubEnv('GIT_CONFIG_COUNT', '2');
    vi.stubEnv('GIT_CONFIG_KEY_0', 'core.autocrlf');
    vi.stubEnv('GIT_CONFIG_VALUE_0', 'true');
    vi.stubEnv('GIT_CONFIG_KEY_1', 'core.eol');
    vi.stubEnv('GIT_CONFIG_VALUE_1', 'crlf');
    writeTree(upstream, { '.gitattributes': '* text=auto\n' });
    commitAll(upstream, 'attributes');
    updateClone(deps, url, 'main', clone);
    expect(read('docs/a.md')).toBe('one\n');
    writeTree(upstream, { 'docs/a.md': 'one\ntwo\n' });
    commitAll(upstream, 'second');
    updateClone(deps, url, 'main', clone);
    expect(read('docs/a.md')).toBe('one\ntwo\n');
  });

  it('re-clones a clone that cannot be updated', () => {
    updateClone(deps, url, 'main', clone);
    fs.writeFileSync(path.join(clone, '.git', 'HEAD'), 'garbage');
    expect(updateClone(deps, url, 'main', clone)).toBe(head());
    expect(read('docs/a.md')).toBe('one\n');
    expect(lines[1]).toMatch(/^RECLONE .*: update failed: /);
    expect(lines[2]).toBe(`CLONE ${url} (main)`);
  });

  it('replaces a clone directory that is not a git repo', () => {
    writeTree(clone, { 'leftover.txt': 'x' });
    updateClone(deps, url, 'main', clone);
    expect(fs.existsSync(path.join(clone, 'leftover.txt'))).toBe(false);
    expect(read('docs/a.md')).toBe('one\n');
  });

  it('throws when the ref does not exist', () => {
    expect(() => updateClone(deps, url, 'no-such-ref', clone)).toThrow(
      /git .*clone/,
    );
  });
});
