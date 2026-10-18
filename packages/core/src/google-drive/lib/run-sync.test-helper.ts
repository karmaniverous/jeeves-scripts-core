/**
 * Shared sandbox and fakes for the syncOne end-to-end tests.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach } from 'vitest';

import { BudgetConfigSchema, SyncEntrySchema } from './config.js';
import type { DriveClient } from './drive-client.js';
import { createRunBudget } from './execute.js';
import { fakeDrive, file } from './fake-drive.test-helper.js';
import type { FetchLike } from './meta-seed.js';
import type { SyncOptions } from './run-sync.js';
import { FOLDER_MIME } from './types.js';

export const cfg = SyncEntrySchema.parse({
  account: 'assistant@example.com',
  pathResolution: { domains: ['example.com'] },
});
const ext = {
  owners: [{ emailAddress: 'ext@example.org' }],
  sharingUser: { emailAddress: 'ext@example.org' },
};
export const folder = file({
  id: 'F',
  name: 'Project',
  mimeType: FOLDER_MIME,
  ...ext,
});
export const note = file({
  id: 'n',
  name: 'notes.txt',
  parents: ['F'],
  md5Checksum: 'v1',
});

let dir = '';

/** The per-test sandbox directory (set by {@link useSandbox}). */
export const sandboxDir = (): string => dir;

/** Create a fresh sandbox before each test and remove it after. */
export function useSandbox(): void {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdrive-sync-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

export function drive(shared: boolean, body = 'hello'): DriveClient {
  const c = fakeDrive(
    shared ? { sharedWithMe: [folder], children: [note] } : {},
  );
  c.downloadTo = (_id, out) => {
    fs.writeFileSync(out, body);
    return out;
  };
  return c;
}

/** The meta service, simulated: creates `.meta/` and answers 201. */
const seedFetch: FetchLike = (_url, init) => {
  const body: unknown =
    typeof init.body === 'string' ? JSON.parse(init.body) : null;
  const p =
    body !== null &&
    typeof body === 'object' &&
    'path' in body &&
    typeof body.path === 'string'
      ? body.path
      : null;
  if (p === null) return Promise.resolve(new Response('', { status: 400 }));
  fs.mkdirSync(path.join(p, '.meta'), { recursive: true });
  return Promise.resolve(new Response('', { status: 201 }));
};

export function opts(
  client: DriveClient,
  live: boolean,
  log: string[] = [],
): SyncOptions {
  return {
    live,
    allowMassDelete: false,
    budget: createRunBudget(BudgetConfigSchema.parse({}), Date.now()),
    shouldStop: () => false,
    log: (l) => log.push(l),
    client,
    contentDir: path.join(dir, 'content'),
    stagingRoot: path.join(dir, 'staging'),
    fetchFn: seedFetch,
  };
}

export const target = (): string => path.join(dir, 'content', 'google-drive');
export const tree = (): string[] =>
  fs.existsSync(target())
    ? fs
        .readdirSync(target(), { recursive: true, encoding: 'utf8' })
        .map((p) => p.split(path.sep).join('/'))
        .sort()
    : [];
