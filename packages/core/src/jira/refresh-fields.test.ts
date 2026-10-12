import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeFetch } from '../lib/fake-fetch.test-helper.js';
import {
  jiraTempDir,
  jiraTestDeps,
  noJiraCredentials,
} from './lib/jira-deps.test-helper.js';
import { refreshJiraFields } from './refresh-fields.js';

let dir: string;
beforeEach(() => {
  dir = jiraTempDir();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('refreshJiraFields', () => {
  it('writes the custom field map only', async () => {
    const fake = fakeFetch(() => ({
      body: [
        { id: 'customfield_1', name: 'Story Points', custom: true },
        { id: 'summary', name: 'Summary', custom: false },
        { id: 'other_9', name: 'Odd', custom: true },
      ],
    }));
    await refreshJiraFields(jiraTestDeps(dir, fake));
    expect(fake.calls[0]?.url.pathname).toBe('/rest/api/3/field');
    expect(
      JSON.parse(
        fs.readFileSync(path.join(dir, 'jira', '_fields.json'), 'utf8'),
      ),
    ).toEqual({ customfield_1: 'Story Points' });
  });

  it('skips without credentials', async () => {
    const fake = fakeFetch(() => ({ body: [] }));
    await refreshJiraFields(noJiraCredentials(jiraTestDeps(dir, fake)));
    expect(fake.calls).toEqual([]);
    expect(console.log).toHaveBeenCalledWith(
      '[skip] Jira API credentials not configured',
    );
  });

  it('fails on an API error', async () => {
    const fake = fakeFetch(() => ({ status: 401, body: 'no' }));
    await expect(refreshJiraFields(jiraTestDeps(dir, fake))).rejects.toThrow(
      'Jira API 401 field: no',
    );
  });
});
