import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeFetch } from '../lib/fake-fetch.test-helper.js';
import { jiraBackfill, RATE_LIMIT_MS } from './backfill.js';
import { jiraJobDeps } from './lib/jira-deps.js';
import {
  jiraTempDir,
  jiraTestDeps,
  noJiraCredentials,
} from './lib/jira-deps.test-helper.js';

let dir: string;
const issues = [
  { id: '1', key: 'ACME-1', fields: { summary: 'one' } },
  { id: '2', key: 'ACME-2', fields: { summary: 'two' } },
];
const search = () => fakeFetch(() => ({ body: { total: 2, issues } }));

beforeEach(() => {
  dir = jiraTempDir();
  process.exitCode = undefined;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('jiraBackfill', () => {
  it('skips without credentials', async () => {
    const fake = search();
    await jiraBackfill(
      ['--project', 'ACME'],
      noJiraCredentials(jiraTestDeps(dir, fake)),
    );
    expect(console.log).toHaveBeenCalledWith(
      '[skip] Jira API credentials not configured',
    );
    expect(fake.calls).toEqual([]);
  });

  it.each([
    [[], '[error] --project <key> is required'],
    [
      ['--project', 'ACME', '--type', 'sprint'],
      '[error] --type "sprint" is not yet supported (only "issue")',
    ],
  ])('rejects %j with exit code 1', async (args, message) => {
    const fake = search();
    await jiraBackfill(args, jiraTestDeps(dir, fake));
    expect(console.error).toHaveBeenCalledWith(message);
    expect(process.exitCode).toBe(1);
    expect(fake.calls).toEqual([]);
  });

  it('only logs in a dry run', async () => {
    const fake = search();
    await jiraBackfill(['--project', 'ACME'], jiraTestDeps(dir, fake));
    expect(fake.calls[0]?.url.searchParams.get('jql')).toBe(
      'project = ACME ORDER BY created ASC',
    );
    expect(console.log).toHaveBeenCalledWith('[backfill] dry-run ACME-1');
    expect(fs.existsSync(path.join(dir, 'jira'))).toBe(false);
    expect(process.exitCode).toBeUndefined();
  });

  it('writes new issues live, skips existing ones and rate-limits', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const deps = jiraTestDeps(dir, search(), { sleep });
    fs.mkdirSync(path.join(dir, 'jira', 'issue'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'jira', 'issue', 'ACME-2.json'), '{}');
    await jiraBackfill(['--project', 'ACME', '--live'], deps);
    const written = JSON.parse(
      fs.readFileSync(path.join(dir, 'jira', 'issue', 'ACME-1.json'), 'utf8'),
    ) as { current: unknown; meta: { lastBackfill: string } };
    expect(written.current).toEqual(issues[0]);
    expect(written.meta.lastBackfill).toBe('2026-01-01T00:00:00.000Z');
    expect(
      fs.readFileSync(path.join(dir, 'jira', 'issue', 'ACME-2.json'), 'utf8'),
    ).toBe('{}');
    expect(console.log).toHaveBeenCalledWith(
      '[backfill] done \u2014 created=1 skipped=1 failed=0',
    );
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(RATE_LIMIT_MS);
  });

  it('counts a failed write and sets exit code 1', async () => {
    // A file where the issue directory belongs makes every write fail.
    fs.mkdirSync(path.join(dir, 'jira'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'jira', 'issue'), '');
    await jiraBackfill(
      ['--project', 'ACME', '--live'],
      jiraTestDeps(dir, search()),
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(/^\[backfill\] error ACME-1: /),
    );
    expect(process.exitCode).toBe(1);
  });
});

describe('jiraJobDeps', () => {
  it('resolves settings and the archive directory from config', () => {
    const live = jiraJobDeps();
    expect(path.basename(live.domainDir)).toBe('jira');
    expect(live.settings.siteUrl).toBe('');
    expect(live.fieldsFilename).toBe('_fields.json');
    expect(live.boardId).toBeUndefined();
  });
});
