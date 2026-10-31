import fs from 'node:fs';

import { parseRunnableArgs } from '@karmaniverous/jeeves';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeFetch, type FetchCall } from '../lib/fake-fetch.test-helper.js';
import {
  jiraTempDir,
  jiraTestDeps,
  noJiraCredentials,
} from './lib/jira-deps.test-helper.js';
import { sortJiraBacklog, sortJiraBacklogFlags } from './sort-backlog.js';

const flagsOf = (args: string[]) =>
  parseRunnableArgs(args, sortJiraBacklogFlags);

let dir: string;
let out: string[];

const issue = (key: string, priority?: string, type = 'Task') => ({
  key,
  fields: {
    summary: `s ${key}`,
    issuetype: { name: type },
    ...(priority ? { priority: { name: priority } } : {}),
  },
});

const board = (issues: unknown[]) => {
  const fake = fakeFetch((call: FetchCall) =>
    call.method === 'PUT'
      ? { body: {} }
      : { body: { total: issues.length, issues } },
  );
  return fake;
};

beforeEach(() => {
  dir = jiraTempDir();
  out = [];
  process.exitCode = undefined;
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    out.push(a.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

const text = () => out.join('\n');

describe('sortJiraBacklog', () => {
  it('fails with exit code 1 when no board is configured', async () => {
    const fake = board([]);
    await sortJiraBacklog(
      flagsOf([]),
      jiraTestDeps(dir, fake, { boardId: undefined }),
    );
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('integrations.jira.boardId'),
    );
    expect(fake.calls).toEqual([]);
  });

  it('skips without credentials', async () => {
    const fake = board([]);
    await sortJiraBacklog(
      flagsOf([]),
      noJiraCredentials(jiraTestDeps(dir, fake)),
    );
    expect(text()).toContain('[skip] Jira API credentials not configured');
    expect(fake.calls).toEqual([]);
  });

  it('has nothing to sort in a one-issue backlog', async () => {
    await sortJiraBacklog(
      flagsOf([]),
      jiraTestDeps(dir, board([issue('A-1')])),
    );
    expect(text()).toContain('Nothing to sort.');
  });

  it('reports an already sorted backlog, skipping epics', async () => {
    const fake = board([
      issue('A-1', 'High'),
      issue('E-1', 'Low', 'Epic'),
      issue('A-2', 'Low'),
    ]);
    await sortJiraBacklog(flagsOf([]), jiraTestDeps(dir, fake));
    expect(text()).toContain('Skipping 1 epic(s) \u2014 not included in sort');
    expect(text()).toContain('\u2705 Backlog is already sorted by priority.');
    expect(fake.calls.filter((c) => c.method === 'PUT')).toEqual([]);
  });

  it('previews the new order in a dry run without ranking', async () => {
    const fake = board([
      issue('A-1', 'Low'),
      issue('A-2', 'High'),
      issue('A-3', 'Weird'),
      issue('A-4'),
    ]);
    await sortJiraBacklog(flagsOf([]), jiraTestDeps(dir, fake));
    expect(text()).toContain('=== Jira Backlog Priority Sort (DRY-RUN) ===');
    expect(text()).toContain('Priority distribution:');
    expect(text()).toContain(
      'Weird: 1 (unknown \u2014 sorted just before Lowest)',
    );
    expect(text()).toContain(
      '3 of 4 issues will change position (first diff at rank 1).',
    );
    expect(text()).toContain('1. A-4 [(none)] s A-4');
    expect(text()).toContain(
      '[dry-run] Would make ~1 API call(s). Run with --live to apply.',
    );
    expect(fake.calls.filter((c) => c.method === 'PUT')).toEqual([]);
  });

  it('re-ranks live through the Agile rank API', async () => {
    const fake = board([issue('A-1', 'Low'), issue('A-2', 'High')]);
    await sortJiraBacklog(flagsOf(['--live']), jiraTestDeps(dir, fake));
    const puts = fake.calls.filter((c) => c.method === 'PUT');
    expect(puts.length).toBeGreaterThan(0);
    expect(puts[0]?.url.pathname).toBe('/rest/agile/1.0/issue/rank');
    expect(text()).toContain(
      `\u2705 Backlog re-ranked. ${String(puts.length)} API call(s).`,
    );
  });
});
