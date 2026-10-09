/**
 * @module agile-api
 *
 * Jira Agile REST transport (`/rest/agile/1.0/`): GET/PUT helpers and the
 * paginated board backlog fetch. Network I/O only; no sorting logic.
 */

import { constants } from '../../lib/constants.js';
import type { AgileIssue } from './backlog-sort.js';

interface BoardBacklogResponse {
  maxResults: number;
  startAt: number;
  total: number;
  issues: AgileIssue[];
}

async function agileGet<T>(
  authHeader: string,
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${constants().JIRA_SITE_URL}/rest/agile/1.0/${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: authHeader, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Agile GET ${String(res.status)} ${path}: ${body}`);
  }
  return res.json() as Promise<T>;
}

/** PUT a JSON body to an Agile API path; throws on non-2xx. */
export async function agilePut(
  authHeader: string,
  path: string,
  body: unknown,
): Promise<void> {
  const url = new URL(`${constants().JIRA_SITE_URL}/rest/agile/1.0/${path}`);
  const res = await fetch(url.toString(), {
    method: 'PUT',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Agile PUT ${String(res.status)} ${path}: ${body}`);
  }
}

/** Fetch every issue in a board's backlog, following pagination. */
export async function fetchBacklog(
  authHeader: string,
  boardId: number,
): Promise<AgileIssue[]> {
  const all: AgileIssue[] = [];
  let startAt = 0;
  const pageSize = 50;

  for (;;) {
    const page = await agileGet<BoardBacklogResponse>(
      authHeader,
      `board/${String(boardId)}/backlog`,
      {
        startAt: String(startAt),
        maxResults: String(pageSize),
        fields: 'priority,summary,issuetype',
      },
    );
    all.push(...page.issues);
    if (all.length >= page.total || page.issues.length === 0) break;
    startAt += page.issues.length;
  }

  return all;
}
