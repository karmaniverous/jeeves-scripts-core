/**
 * @module jira/lib/agile-api
 *
 * Jira Agile calls the backlog sorter makes, over the shared client
 * (`jira/lib/jira-client`): the paginated board backlog and the issue rank
 * PUT. Network I/O only; no sorting logic.
 */

import type { AgileIssue } from './backlog-sort.js';
import { type JiraConnection, jiraRequest } from './jira-client.js';

interface BoardBacklogResponse {
  total: number;
  issues: AgileIssue[];
}

/** PUT a JSON body to an Agile API path. */
export async function agilePut(
  conn: JiraConnection,
  path: string,
  body: unknown,
): Promise<void> {
  await jiraRequest<undefined>(conn, 'agile/1.0', path, {
    method: 'PUT',
    body,
  });
}

/** Fetch every issue in a board's backlog, following pagination. */
export async function fetchBacklog(
  conn: JiraConnection,
  boardId: number,
): Promise<AgileIssue[]> {
  const all: AgileIssue[] = [];
  let startAt = 0;
  for (;;) {
    const page = await jiraRequest<BoardBacklogResponse>(
      conn,
      'agile/1.0',
      `board/${String(boardId)}/backlog`,
      {
        params: {
          startAt: String(startAt),
          maxResults: '50',
          fields: 'priority,summary,issuetype',
        },
      },
    );
    all.push(...page.issues);
    if (all.length >= page.total || page.issues.length === 0) break;
    startAt += page.issues.length;
  }
  return all;
}
