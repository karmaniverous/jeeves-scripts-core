/**
 * @module jira/lib/jira-client
 *
 * The one Jira Cloud HTTP client: a connection (site URL, HTTP Basic auth
 * from the email and the API token file, `fetch`), `jiraRequest` over the
 * REST v3 and Agile 1.0 APIs, `jiraGet`, and the paginated JQL search.
 * Network I/O through the injected `fetch`; reads the token file once.
 */

import fs from 'node:fs';

/** A Jira field from `GET /rest/api/3/field`. */
export interface JiraField {
  id: string;
  name: string;
  custom: boolean;
  schema?: { type: string; custom?: string };
}

/** One page of a JQL search. */
export interface JiraSearchResult {
  total: number;
  startAt: number;
  maxResults: number;
  issues: JiraIssue[];
}

/** A Jira issue as the search returns it. */
export interface JiraIssue {
  id: string;
  key: string;
  fields: Record<string, unknown>;
}

/** The Jira settings a connection needs (`integrations.jira`). */
export interface JiraSettings {
  siteUrl: string;
  email: string;
  apiTokenPath: string;
}

/** An authenticated Jira site. */
export interface JiraConnection {
  /** e.g. `https://acme.atlassian.net` */
  siteUrl: string;
  /** HTTP Basic `Authorization` header value. */
  authHeader: string;
  /** The `fetch` used for every request. */
  fetch: typeof fetch;
}

/** Whether every setting a connection needs is set. */
export const hasJiraCredentials = (s: JiraSettings): boolean =>
  Boolean(s.siteUrl && s.email && s.apiTokenPath);

/** Connect: read the API token file and build the Basic auth header. */
export function jiraConnection(
  settings: JiraSettings,
  fetchImpl: typeof fetch = fetch,
): JiraConnection {
  const apiToken = fs.readFileSync(settings.apiTokenPath, 'utf8').trim();
  return {
    siteUrl: settings.siteUrl,
    authHeader: `Basic ${Buffer.from(`${settings.email}:${apiToken}`).toString('base64')}`,
    fetch: fetchImpl,
  };
}

/** Which REST API a request goes to. */
export type JiraApi = 'api/3' | 'agile/1.0';

/** A request's method, query parameters and JSON body. */
export interface JiraRequestInit {
  method?: 'GET' | 'PUT';
  params?: Record<string, string>;
  body?: unknown;
}

/**
 * Send a request to `/rest/<api>/<path>`; resolves to the parsed JSON body
 * of a GET, `undefined` for a PUT.
 *
 * @throws On a non-2xx status, naming the API, status and path.
 */
export async function jiraRequest<T>(
  conn: JiraConnection,
  api: JiraApi,
  path: string,
  init: JiraRequestInit = {},
): Promise<T> {
  const method = init.method ?? 'GET';
  const url = new URL(`${conn.siteUrl}/rest/${api}/${path}`);
  for (const [k, v] of Object.entries(init.params ?? {}))
    url.searchParams.set(k, v);
  const headers: Record<string, string> = {
    Authorization: conn.authHeader,
    Accept: 'application/json',
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await conn.fetch(url.toString(), {
    method,
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  if (!res.ok) {
    const label = api === 'api/3' ? 'Jira API' : `Agile ${method}`;
    throw new Error(
      `${label} ${String(res.status)} ${path}: ${await res.text()}`,
    );
  }
  return (method === 'GET' ? await res.json() : undefined) as T;
}

/** GET from the REST v3 API. */
export const jiraGet = <T>(
  conn: JiraConnection,
  path: string,
  params?: Record<string, string>,
): Promise<T> => jiraRequest<T>(conn, 'api/3', path, params ? { params } : {});

/**
 * Page through a JQL search, yielding each issue.
 *
 * @param fields - Comma-separated field list (`'*all'` for everything).
 * @param maxResults - Page size.
 */
export async function* searchIssues(
  conn: JiraConnection,
  jql: string,
  fields = '*all',
  maxResults = 50,
): AsyncGenerator<JiraIssue> {
  let startAt = 0;
  let fetched = 0;
  let total = Infinity;
  while (fetched < total) {
    const result = await jiraGet<JiraSearchResult>(conn, 'search', {
      jql,
      fields,
      startAt: String(startAt),
      maxResults: String(maxResults),
    });
    total = result.total;
    for (const issue of result.issues) {
      yield issue;
      fetched++;
    }
    startAt += result.issues.length;
    if (result.issues.length === 0) break;
  }
}
