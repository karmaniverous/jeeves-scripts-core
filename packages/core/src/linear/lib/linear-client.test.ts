/**
 * Tests for linear-client: enrichComment, loadConfig (temp config file),
 * linearQuery and the paginators (stubbed global fetch).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { CONFIG_PATH_ENV, resetConfig } from '../../config/loader.js';
import {
  enrichComment,
  type LinearConfig,
  linearQuery,
  loadConfig,
  paginateComments,
  paginateIssues,
} from './linear-client.js';

const config: LinearConfig = {
  apiKey: 'lin_key',
  apiUrl: 'https://linear.test/graphql',
};

/** Stub fetch with a sequence of JSON (or raw text) responses. */
const stubFetch = (...responses: { status?: number; body: unknown }[]) => {
  const fetchMock = vi.fn<typeof fetch>();
  for (const { status = 200, body } of responses)
    fetchMock.mockResolvedValueOnce(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
      }),
    );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

/** The parsed JSON body of one fetch call. */
const bodyOf = (fetchMock: ReturnType<typeof stubFetch>, i: number) =>
  JSON.parse(z.string().parse(fetchMock.mock.calls[i]?.[1]?.body)) as {
    query: string;
    variables: Record<string, unknown>;
  };

const collect = async <T>(gen: AsyncGenerator<T>): Promise<T[]> => {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('enrichComment', () => {
  it('adds _issueIdentifier when issue.identifier is present', () => {
    const raw = {
      id: 'c1',
      body: 'hello',
      issue: { id: 'i1', identifier: 'ENG-42' },
    };
    const result = enrichComment(raw);
    expect(result._issueIdentifier).toBe('ENG-42');
  });

  it('returns shallow copy (does not mutate input)', () => {
    const raw = {
      id: 'c1',
      body: 'hello',
      issue: { id: 'i1', identifier: 'ENG-42' },
    };
    const result = enrichComment(raw);
    expect(result).not.toBe(raw);
    expect(raw).not.toHaveProperty('_issueIdentifier');
  });

  it('does NOT add _issueIdentifier when issue is absent', () => {
    const raw = { id: 'c1', body: 'standalone comment' };
    const result = enrichComment(raw);
    expect(result).not.toHaveProperty('_issueIdentifier');
  });

  it('does NOT add _issueIdentifier when issue has no identifier', () => {
    const raw = {
      id: 'c1',
      body: 'hello',
      issue: { id: 'i1' },
    };
    const result = enrichComment(raw);
    expect(result).not.toHaveProperty('_issueIdentifier');
  });
});

describe('loadConfig', () => {
  const saved = process.env[CONFIG_PATH_ENV];
  const savedLinear = process.env.LINEAR_CONFIG_PATH;

  const withLinearFile = (content: unknown, run: () => void) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linear-'));
    const configPath = path.join(dir, 'jeeves-scripts.json');
    const linearPath = path.join(dir, 'linear.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({ instance: { name: 't', baseDir: dir } }),
    );
    fs.writeFileSync(linearPath, JSON.stringify(content));
    process.env[CONFIG_PATH_ENV] = configPath;
    process.env.LINEAR_CONFIG_PATH = linearPath;
    resetConfig();
    try {
      run();
    } finally {
      process.env[CONFIG_PATH_ENV] = saved;
      if (savedLinear === undefined) delete process.env.LINEAR_CONFIG_PATH;
      else process.env.LINEAR_CONFIG_PATH = savedLinear;
      resetConfig();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it('reads the file at LINEAR_CONFIG_PATH', () => {
    withLinearFile({ ...config, webhookSecret: 's' }, () => {
      expect(loadConfig()).toEqual({ ...config, webhookSecret: 's' });
    });
  });

  it('rejects a file without string apiKey and apiUrl', () => {
    withLinearFile({ apiKey: 1 }, () => {
      expect(() => loadConfig()).toThrow(
        /Invalid Linear config at .*linear\.json: must contain string apiKey and apiUrl/,
      );
    });
  });
});

describe('linearQuery', () => {
  it('POSTs the query and variables with the API key and returns data', async () => {
    const fetchMock = stubFetch({ body: { data: { viewer: { id: 'u1' } } } });
    await expect(
      linearQuery(config, 'query { viewer { id } }', { a: 1 }),
    ).resolves.toEqual({ viewer: { id: 'u1' } });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(config.apiUrl);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ Authorization: 'lin_key' });
    expect(bodyOf(fetchMock, 0)).toEqual({
      query: 'query { viewer { id } }',
      variables: { a: 1 },
    });
  });

  it('throws on an HTTP error with the status and body', async () => {
    stubFetch({ status: 401, body: 'unauthorized' });
    await expect(linearQuery(config, 'q')).rejects.toThrow(
      'Linear API 401: unauthorized',
    );
  });

  it('throws on GraphQL errors, joining the messages', async () => {
    stubFetch({ body: { errors: [{ message: 'a' }, { message: 'b' }] } });
    await expect(linearQuery(config, 'q')).rejects.toThrow(
      'Linear GraphQL errors: a; b',
    );
  });

  it('throws when the response has no data', async () => {
    stubFetch({ body: {} });
    await expect(linearQuery(config, 'q')).rejects.toThrow(
      'Linear GraphQL response missing data field',
    );
  });
});

describe('paginateIssues', () => {
  it('follows endCursor until hasNextPage is false, passing filters', async () => {
    const fetchMock = stubFetch(
      {
        body: {
          data: {
            issues: {
              nodes: [{ id: 'i1' }, { id: 'i2' }],
              pageInfo: { hasNextPage: true, endCursor: 'c1' },
            },
          },
        },
      },
      {
        body: {
          data: {
            issues: {
              nodes: [{ id: 'i3' }],
              pageInfo: { hasNextPage: false, endCursor: 'c2' },
            },
          },
        },
      },
    );
    const issues = await collect(
      paginateIssues(config, 'CRE', '2026-01-01T00:00:00Z'),
    );
    expect(issues.map((i) => i.id)).toEqual(['i1', 'i2', 'i3']);
    expect(bodyOf(fetchMock, 0).variables).toEqual({
      cursor: null,
      teamKey: 'CRE',
      updatedAfter: '2026-01-01T00:00:00Z',
    });
    expect(bodyOf(fetchMock, 1).variables.cursor).toBe('c1');
    expect(bodyOf(fetchMock, 0).query).toContain(
      'filter: { team: { key: { eq: $teamKey } }, updatedAt: { gte: $updatedAfter } }',
    );
  });

  it('declares no filter or filter variables when none are given', async () => {
    const fetchMock = stubFetch({
      body: {
        data: {
          issues: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    });
    expect(await collect(paginateIssues(config))).toEqual([]);
    const { query, variables } = bodyOf(fetchMock, 0);
    expect(query).not.toContain('filter:');
    expect(query).not.toContain('$teamKey');
    expect(variables).toEqual({ cursor: null });
  });
});

describe('paginateComments', () => {
  it('pages comments with an optional updatedAfter filter', async () => {
    const fetchMock = stubFetch(
      {
        body: {
          data: {
            comments: {
              nodes: [{ id: 'c1' }],
              pageInfo: { hasNextPage: true, endCursor: 'x' },
            },
          },
        },
      },
      {
        body: {
          data: {
            comments: {
              nodes: [{ id: 'c2' }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    );
    const comments = await collect(paginateComments(config, '2026-02-01'));
    expect(comments.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(bodyOf(fetchMock, 0).query).toContain(
      'filter: { updatedAt: { gte: $updatedAfter } }',
    );
    expect(bodyOf(fetchMock, 1).variables).toEqual({
      cursor: 'x',
      updatedAfter: '2026-02-01',
    });
  });
});
