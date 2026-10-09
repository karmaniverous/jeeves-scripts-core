/**
 * @module jira-client
 *
 * Minimal Jira Cloud REST API v3 client for jeeves-scripts.
 *
 * Handles basic-auth construction and typed GET requests. All API calls
 * are unauthenticated with HTTP basic auth (email + API token). Node's
 * built-in fetch (v18+) is used — no extra dependencies.
 */

import fs from 'node:fs';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface JiraField {
  id: string;
  name: string;
  custom: boolean;
  schema?: { type: string; custom?: string };
}

export interface JiraSearchResult {
  total: number;
  startAt: number;
  maxResults: number;
  issues: JiraIssue[];
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: Record<string, unknown>;
  changelog?: { histories: JiraChangelogHistory[] };
}

export interface JiraChangelogHistory {
  id: string;
  author: { displayName: string; emailAddress?: string };
  created: string;
  items: Array<{
    field: string;
    fieldtype?: string;
    fromString?: string;
    toString?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/** Read an API token from a file, trimming trailing whitespace. */
export function readApiToken(tokenPath: string): string {
  return fs.readFileSync(tokenPath, 'utf8').trim();
}

/** Build an HTTP Basic Authorization header value. */
export function makeAuthHeader(email: string, apiToken: string): string {
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
}

// ---------------------------------------------------------------------------
// API request helper
// ---------------------------------------------------------------------------

/**
 * Perform a GET request against the Jira Cloud REST API v3.
 *
 * @param siteUrl    e.g. `https://mysite.atlassian.net`
 * @param authHeader HTTP Basic auth header (from `makeAuthHeader`)
 * @param apiPath    Path relative to `/rest/api/3/` (e.g. `field`)
 * @param params     Optional query string parameters
 */
export async function jiraGet<T>(
  siteUrl: string,
  authHeader: string,
  apiPath: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${siteUrl}/rest/api/3/${apiPath}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: authHeader, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jira API ${String(res.status)} ${apiPath}: ${body}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Paginate a Jira JQL search, yielding issues in batches.
 *
 * @param siteUrl    Jira site base URL
 * @param authHeader HTTP Basic auth header
 * @param jql        JQL query string
 * @param fields     Comma-separated field list (pass `'*all'` for everything)
 * @param expand     Optional comma-separated expand list (e.g. `'changelog'`)
 * @param maxResults Page size (default 50, max 100 for most Jira instances)
 */
export async function* searchIssues(
  siteUrl: string,
  authHeader: string,
  jql: string,
  fields = '*all',
  expand?: string,
  maxResults = 50,
): AsyncGenerator<JiraIssue> {
  let startAt = 0;
  let fetched = 0;
  let total = Infinity;

  while (fetched < total) {
    const params: Record<string, string> = {
      jql,
      fields,
      startAt: String(startAt),
      maxResults: String(maxResults),
    };
    if (expand) params.expand = expand;

    const result = await jiraGet<JiraSearchResult>(
      siteUrl,
      authHeader,
      'search',
      params,
    );

    total = result.total;
    for (const issue of result.issues) {
      yield issue;
      fetched++;
    }
    startAt += result.issues.length;
    if (result.issues.length === 0) break;
  }
}
