/**
 * @module library/lib/library.test-helper
 *
 * Temp-dir trees and local git repos for the library mirror's tests. Test
 * support only.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { run } from '@karmaniverous/jeeves';

import type { MirrorOptions } from './mirror.js';
import { listFiles } from './stage.js';

/** Write `files` (relative path to content) under `root`. */
export const writeTree = (
  root: string,
  files: Record<string, string | Buffer>,
): void => {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
};

/** Every file under `root` with its content and mtime. */
export const snapshot = (root: string): Record<string, [string, number]> =>
  Object.fromEntries(
    listFiles(root).map((rel) => {
      const abs = path.join(root, rel);
      return [
        rel,
        [fs.readFileSync(abs, 'latin1'), fs.statSync(abs).mtimeMs],
      ] as const;
    }),
  );

/** A `mirrorTree` test world: its temp root, options and log lines. */
export interface MirrorFixture {
  root: string;
  opts: MirrorOptions;
  lines: string[];
}

/**
 * A fresh temp root (named `prefix`) holding `upstream` in the clone (under
 * `subdir`), with `mirrorTree` options for it: state under `state/`, the
 * destination at `content/library/<dest>`, live, every log line collected.
 * `options` overrides the rest (`exclude` `[]` and `minRatio` 0.5 by
 * default). The caller removes `root`.
 */
export const mirrorFixture = (
  prefix: string,
  upstream: Record<string, string | Buffer>,
  {
    subdir = '',
    dest,
    ...options
  }: { subdir?: string; dest: string } & Partial<
    Omit<MirrorOptions, 'paths' | 'log'>
  >,
): MirrorFixture => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const source = path.join(root, 'clone', subdir);
  writeTree(source, upstream);
  const lines: string[] = [];
  const state = (name: string) => path.join(root, 'state', name);
  return {
    root,
    lines,
    opts: {
      paths: {
        clone: path.join(root, 'clone'),
        source,
        stage: state('stage'),
        tmp: state('tmp'),
        incoming: state('incoming'),
        dest: path.join(root, 'content', 'library', dest),
        record: state('published.json'),
      },
      live: true,
      head: 'abc1234',
      exclude: [],
      minRatio: 0.5,
      log: (l) => lines.push(l),
      ...options,
    },
  };
};

/** Git identity and settings for test commits, whatever the host's config. */
const GIT = [
  '-c',
  'user.name=Test',
  '-c',
  'user.email=test@example.com',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.autocrlf=false',
];

/** Run git in `dir`. */
export const git = (dir: string, ...args: string[]): string =>
  run('git', [...GIT, '-C', dir, ...args]);

/** A local repo at `dir` on branch `main`, with `files` committed; returns its file URL. */
export const makeRepo = (
  dir: string,
  files: Record<string, string | Buffer>,
): string => {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '--quiet', '--initial-branch=main');
  writeTree(dir, files);
  commitAll(dir, 'initial');
  return pathToFileURL(dir).href;
};

/** Commit everything in `dir`. */
export const commitAll = (dir: string, message: string): void => {
  git(dir, 'add', '--all');
  git(dir, 'commit', '--quiet', '--allow-empty', '-m', message);
};
