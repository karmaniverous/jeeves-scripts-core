import fs from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { fakeFetch } from '../../lib/fake-fetch.test-helper.js';
import { fetchBacklog } from './agile-api.js';
import {
  hasJiraCredentials,
  jiraConnection,
  jiraGet,
  jiraRequest,
  searchIssues,
} from './jira-client.js';
import { jiraTempDir, jiraTestDeps } from './jira-deps.test-helper.js';

let dir = '';
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

const connect = (fake: ReturnType<typeof fakeFetch>) => {
  dir = jiraTempDir();
  return jiraConnection(jiraTestDeps(dir, fake).settings, fake.fetch);
};

describe('jiraConnection', () => {
  it('builds Basic auth from the email and the trimmed token file', async () => {
    const fake = fakeFetch(() => ({ body: [] }));
    const conn = connect(fake);
    expect(conn.authHeader).toBe(
      `Basic ${Buffer.from('jane@example.com:secret').toString('base64')}`,
    );
    await jiraGet(conn, 'field');
    expect(fake.calls[0]?.url.href).toBe(
      'https://acme.atlassian.net/rest/api/3/field',
    );
    expect(fake.calls[0]?.headers.Authorization).toBe(conn.authHeader);
  });

  it('reports missing credentials', () => {
    const s = { siteUrl: 'u', email: 'e', apiTokenPath: 't' };
    expect(hasJiraCredentials(s)).toBe(true);
    expect(hasJiraCredentials({ ...s, email: '' })).toBe(false);
  });
});

describe('jiraRequest', () => {
  it('sends query params and a JSON body, resolving a PUT to undefined', async () => {
    const fake = fakeFetch(() => ({ body: {} }));
    const conn = connect(fake);
    await expect(
      jiraRequest(conn, 'agile/1.0', 'issue/rank', {
        method: 'PUT',
        params: { a: '1' },
        body: { issues: ['ACME-1'] },
      }),
    ).resolves.toBeUndefined();
    const [call] = fake.calls;
    expect(call?.url.href).toBe(
      'https://acme.atlassian.net/rest/agile/1.0/issue/rank?a=1',
    );
    expect(call?.method).toBe('PUT');
    expect(call?.headers['Content-Type']).toBe('application/json');
    expect(call?.body).toEqual({ issues: ['ACME-1'] });
  });

  it.each([
    ['api/3', 'GET', 'Jira API 404 field: missing'],
    ['agile/1.0', 'GET', 'Agile GET 404 field: missing'],
    ['agile/1.0', 'PUT', 'Agile PUT 404 field: missing'],
  ] as const)('names %s %s failures', async (api, method, message) => {
    const conn = connect(fakeFetch(() => ({ status: 404, body: 'missing' })));
    await expect(jiraRequest(conn, api, 'field', { method })).rejects.toThrow(
      message,
    );
  });
});

describe('searchIssues', () => {
  it('pages until the total is reached', async () => {
    const pages = [
      {
        total: 3,
        issues: [
          { id: '1', key: 'A-1', fields: {} },
          { id: '2', key: 'A-2', fields: {} },
        ],
      },
      { total: 3, issues: [{ id: '3', key: 'A-3', fields: {} }] },
    ];
    const fake = fakeFetch(() => ({ body: pages.shift() }));
    const keys: string[] = [];
    for await (const issue of searchIssues(
      connect(fake),
      'project = A',
      '*all',
      2,
    ))
      keys.push(issue.key);
    expect(keys).toEqual(['A-1', 'A-2', 'A-3']);
    expect(fake.calls.map((c) => c.url.searchParams.get('startAt'))).toEqual([
      '0',
      '2',
    ]);
    expect(fake.calls[0]?.url.searchParams.get('jql')).toBe('project = A');
  });

  it('stops on an empty page', async () => {
    const fake = fakeFetch(() => ({ body: { total: 9, issues: [] } }));
    const out: unknown[] = [];
    for await (const issue of searchIssues(connect(fake), 'x')) out.push(issue);
    expect(out).toEqual([]);
    expect(fake.calls).toHaveLength(1);
  });
});

describe('fetchBacklog', () => {
  it('follows pagination and stops on an empty page', async () => {
    const issue = (key: string) => ({ key, fields: {} });
    const pages = [
      { total: 5, issues: [issue('A-1'), issue('A-2')] },
      { total: 5, issues: [issue('A-3')] },
      { total: 5, issues: [] },
    ];
    const fake = fakeFetch(() => ({ body: pages.shift() }));
    const backlog = await fetchBacklog(connect(fake), 6);
    expect(backlog.map((i) => i.key)).toEqual(['A-1', 'A-2', 'A-3']);
    expect(fake.calls[0]?.url.pathname).toBe('/rest/agile/1.0/board/6/backlog');
    expect(fake.calls.map((c) => c.url.searchParams.get('startAt'))).toEqual([
      '0',
      '2',
      '3',
    ]);
  });
});
