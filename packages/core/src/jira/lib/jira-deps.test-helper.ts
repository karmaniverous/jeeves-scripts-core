/**
 * @module jira/lib/jira-deps.test-helper
 *
 * Jira runnable collaborators for tests: a temp archive directory with an
 * API token file, a fake fetch and a fixed clock. Test support only.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { FakeFetch } from '../../lib/fake-fetch.test-helper.js';
import type { JiraJobDeps } from './jira-deps.js';

/** A temp directory holding `token.txt` and the archive (`jira/`). */
export const jiraTempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-'));
  fs.writeFileSync(path.join(dir, 'token.txt'), 'secret\n');
  return dir;
};

/** Collaborators over `dir` and `fake`. */
export const jiraTestDeps = (
  dir: string,
  fake: FakeFetch,
  over: Partial<JiraJobDeps> = {},
): JiraJobDeps => ({
  settings: {
    siteUrl: 'https://acme.atlassian.net',
    email: 'jane@example.com',
    apiTokenPath: path.join(dir, 'token.txt'),
  },
  boardId: 6,
  fetch: fake.fetch,
  domainDir: path.join(dir, 'jira'),
  fieldsFilename: '_fields.json',
  now: () => '2026-01-01T00:00:00.000Z',
  sleep: () => Promise.resolve(),
  ...over,
});

/** The same settings with no site URL (credentials not configured). */
export const noJiraCredentials = (deps: JiraJobDeps): JiraJobDeps => ({
  ...deps,
  settings: { ...deps.settings, siteUrl: '' },
});
