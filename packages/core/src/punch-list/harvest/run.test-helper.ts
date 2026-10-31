/**
 * @module punch-list/harvest/run.test-helper
 *
 * The sandbox the harvester's run tests share: a temp punch-list directory
 * with an instance TASK file, one input file inside the first window, a
 * jeeves-server config, a resolved config with every state path under
 * `state/`, and recording dependencies (worker, Slack, clock, log).
 */

import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { reportItem, testConfig } from '../punch-list.test-helper.js';
import type { HarvestDeps } from './run.js';

/** A fresh sandbox. */
export const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'pl-harvest-'));
  const listDir = join(dir, 'punch-list');
  const input = join(dir, 'content');
  mkdirSync(listDir, { recursive: true });
  mkdirSync(input, { recursive: true });
  writeFileSync(join(listDir, 'TASK.md'), '# Harvest\n\nDo the thing.');
  writeFileSync(join(input, 'new.json'), '{}');
  const inWindow = new Date('2026-10-18T12:00:00Z');
  utimesSync(join(input, 'new.json'), inWindow, inWindow);
  const serverConfig = join(dir, 'server.json');
  writeFileSync(
    serverConfig,
    JSON.stringify({
      publicUrl: 'https://jeeves.example.com',
      roots: { t: dir },
    }),
  );
  const config = testConfig({
    dir: listDir,
    serverConfig,
    timeZone: 'UTC',
    specPath: join(dir, 'spec.md'),
    cursorFile: join(dir, 'state', 'cursor.json'),
    inboxDir: join(dir, 'state', 'inbox'),
    lockFile: join(dir, 'state', 'pl.lock'),
    inputRoots: [input],
    slack: { channel: 'C000PUNCH01', account: 'default', pinnedTs: '1.2' },
  });
  const calls = {
    tasks: [] as string[],
    reportFiles: [] as string[],
    posts: [] as string[],
    updates: [] as string[],
    logs: [] as string[],
  };
  const deps = (reply: string): HarvestDeps => ({
    worker: (task, reportFile) => {
      calls.tasks.push(task);
      calls.reportFiles.push(reportFile);
      writeFileSync(reportFile, reply);
      return Promise.resolve(reply);
    },
    slack: () => ({
      post: (_c, t) => {
        calls.posts.push(t);
        return Promise.resolve();
      },
      update: (_c, _ts, t) => {
        calls.updates.push(t);
        return Promise.resolve();
      },
    }),
    now: () => new Date('2026-10-18T21:47:00Z'),
    log: (m) => calls.logs.push(m),
  });
  return { dir, listDir, input, config, calls, deps };
};

/** A worker reply with one item citing `sources`. */
export const reply = (sources: string[]): string =>
  JSON.stringify({ items: [reportItem({ sources })], summary: 'One need.' });
