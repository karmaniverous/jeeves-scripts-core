/**
 * @module linear-client
 *
 * Minimal typed GraphQL client for the Linear API.
 *
 * Handles config loading and typed POST requests using plain API key auth.
 * Node's built-in fetch (v18+) is used — no extra dependencies.
 */

import fs from 'node:fs';

import { z } from 'zod';

import { constants } from '../../lib/constants.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Delay helper for rate limiting between API calls. */
export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Enrich a raw Linear comment with `_issueIdentifier` cross-reference.
 * Returns a shallow copy with the enrichment applied.
 */
export function enrichComment(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const current: Record<string, unknown> = { ...raw };
  const issueObj = raw.issue as Record<string, unknown> | undefined;
  if (issueObj?.identifier) {
    current._issueIdentifier = issueObj.identifier;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** The Linear config file (`constants().LINEAR_CONFIG_PATH`). */
export const linearConfigSchema = z.object({
  /** Personal API key, sent as the `Authorization` header. */
  apiKey: z.string(),
  /** GraphQL endpoint, e.g. `https://api.linear.app/graphql`. */
  apiUrl: z.string(),
  /** Webhook signing secret (used by the drain). */
  webhookSecret: z.string().optional(),
});

/** Parsed Linear config. */
export type LinearConfig = z.infer<typeof linearConfigSchema>;

// ---------------------------------------------------------------------------
// Config loader
// ---------------------------------------------------------------------------

/** Read and validate constants().LINEAR_CONFIG_PATH. Throws if missing or malformed. */
export function loadConfig(): LinearConfig {
  const file = constants().LINEAR_CONFIG_PATH;
  const parsed = linearConfigSchema.safeParse(
    JSON.parse(fs.readFileSync(file, 'utf8')),
  );
  if (!parsed.success)
    throw new Error(
      `Invalid Linear config at ${file}: must contain string apiKey and apiUrl`,
    );
  return parsed.data;
}

// ---------------------------------------------------------------------------
// GraphQL request helper
// ---------------------------------------------------------------------------

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

/**
 * Execute a GraphQL query against the Linear API.
 *
 * @param config - Linear API config (apiKey, apiUrl)
 * @param query - GraphQL query string
 * @param variables - Optional query variables
 */
export async function linearQuery<T>(
  config: LinearConfig,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      Authorization: config.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Linear API ${String(res.status)}: ${body}`);
  }

  const json = (await res.json()) as GraphQLResponse<T>;

  if (json.errors && json.errors.length > 0) {
    const msgs = json.errors.map((e) => e.message).join('; ');
    throw new Error(`Linear GraphQL errors: ${msgs}`);
  }

  if (json.data === undefined) {
    throw new Error('Linear GraphQL response missing data field');
  }

  return json.data;
}

// ---------------------------------------------------------------------------
// Pagination helpers
// ---------------------------------------------------------------------------

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  priority
  priorityLabel
  state { id name type }
  assignee { id name email }
  team { id key name }
  labels { nodes { id name } }
  project { id name }
  cycle { id number }
  createdAt
  updatedAt
  completedAt
  canceledAt
  url
`;

const COMMENT_FIELDS = `
  id
  body
  createdAt
  updatedAt
  user { id name email }
  issue { id identifier }
`;

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface IssueConnection {
  issues: {
    nodes: Record<string, unknown>[];
    pageInfo: PageInfo;
  };
}

interface CommentConnection {
  comments: {
    nodes: Record<string, unknown>[];
    pageInfo: PageInfo;
  };
}

/**
 * Build a GraphQL query for paginated issue fetch, declaring only
 * the variables and filter clauses that are actually used.
 */
function buildIssueQuery(teamKey?: string, updatedAfter?: string): string {
  const varDecls = ['$cursor: String'];
  const filterClauses: string[] = [];

  if (teamKey !== undefined) {
    varDecls.push('$teamKey: String!');
    filterClauses.push('team: { key: { eq: $teamKey } }');
  }
  if (updatedAfter !== undefined) {
    varDecls.push('$updatedAfter: DateTimeOrDuration!');
    filterClauses.push('updatedAt: { gte: $updatedAfter }');
  }

  const filterArg =
    filterClauses.length > 0 ? `filter: { ${filterClauses.join(', ')} }` : '';

  return `
    query PaginateIssues(${varDecls.join(', ')}) {
      issues(
        ${filterArg}
        first: 50
        after: $cursor
      ) {
        nodes { ${ISSUE_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;
}

/**
 * Cursor-paginated issue fetch. When `teamKey` is omitted, fetches all issues
 * across all teams. When `updatedAfter` is omitted, fetches from the beginning.
 *
 * Yields each issue node individually.
 */
export async function* paginateIssues(
  config: LinearConfig,
  teamKey?: string,
  updatedAfter?: string,
): AsyncGenerator<Record<string, unknown>> {
  const query = buildIssueQuery(teamKey, updatedAfter);
  let cursor: string | null = null;

  do {
    const variables: Record<string, unknown> = { cursor };
    if (teamKey !== undefined) variables.teamKey = teamKey;
    if (updatedAfter !== undefined) variables.updatedAfter = updatedAfter;

    const data = await linearQuery<IssueConnection>(config, query, variables);
    const { nodes, pageInfo } = data.issues;

    for (const node of nodes) {
      yield node;
    }

    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (cursor !== null);
}

/**
 * Build a GraphQL query for paginated comment fetch, declaring only
 * the variables and filter clauses that are actually used.
 */
function buildCommentQuery(updatedAfter?: string): string {
  const varDecls = ['$cursor: String'];
  const filterClauses: string[] = [];

  if (updatedAfter !== undefined) {
    varDecls.push('$updatedAfter: DateTimeOrDuration!');
    filterClauses.push('updatedAt: { gte: $updatedAfter }');
  }

  const filterArg =
    filterClauses.length > 0 ? `filter: { ${filterClauses.join(', ')} }` : '';

  return `
    query PaginateComments(${varDecls.join(', ')}) {
      comments(
        ${filterArg}
        first: 50
        after: $cursor
      ) {
        nodes { ${COMMENT_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;
}

/**
 * Cursor-paginated comment fetch. When `updatedAfter` is omitted, fetches
 * from the beginning.
 *
 * Yields each comment node individually.
 */
export async function* paginateComments(
  config: LinearConfig,
  updatedAfter?: string,
): AsyncGenerator<Record<string, unknown>> {
  const query = buildCommentQuery(updatedAfter);
  let cursor: string | null = null;

  do {
    const variables: Record<string, unknown> = { cursor };
    if (updatedAfter !== undefined) variables.updatedAfter = updatedAfter;

    const data = await linearQuery<CommentConnection>(config, query, variables);
    const { nodes, pageInfo } = data.comments;

    for (const node of nodes) {
      yield node;
    }

    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (cursor !== null);
}
