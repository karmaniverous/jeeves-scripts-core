import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  jiraDrain,
  type JiraDrainDeps,
  jiraDrainDeps,
  jiraRoute,
  loadFieldMap,
} from './drain.js';

let dir: string;
let lines: string[];

const deps = (
  body: unknown,
  over: Partial<JiraDrainDeps> = {},
): JiraDrainDeps => ({
  domainDir: dir,
  fieldsFilename: '_fields.json',
  maxHistory: 2,
  readBody: () => Promise.resolve(body as Record<string, unknown>),
  now: () => '2026-01-01T00:00:00.000Z',
  log: (line) => lines.push(line),
  ...over,
});

const stored = (type: string, key: string): Record<string, unknown> =>
  JSON.parse(
    fs.readFileSync(path.join(dir, type, `${key}.json`), 'utf8'),
  ) as Record<string, unknown>;

const result = (): Record<string, unknown> =>
  JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-drain-'));
  lines = [];
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('jiraDrain', () => {
  it('upserts an issue and translates mapped custom fields', async () => {
    fs.writeFileSync(
      path.join(dir, '_fields.json'),
      JSON.stringify({ customfield_1: 'Story Points' }),
    );
    await jiraDrain(
      deps({
        webhookEvent: 'jira:issue_created',
        issue: {
          key: 'ACME-1',
          fields: { customfield_1: 5, customfield_2: 'x' },
        },
      }),
    );
    expect(result()).toEqual({
      event: 'jira:issue_created',
      action: 'upsert',
      type: 'issue',
      key: 'ACME-1',
      path: path.join(dir, 'issue', 'ACME-1.json'),
    });
    expect(stored('issue', 'ACME-1').current).toEqual({
      key: 'ACME-1',
      fields: { customfield_1: 5, customfield_2: 'x', 'Story Points': 5 },
    });
  });

  it('keeps reverse-diff history across updates, capped at maxHistory', async () => {
    for (const summary of ['a', 'b', 'c', 'd'])
      await jiraDrain(
        deps({
          webhookEvent: 'jira:issue_updated',
          issue: { key: 'ACME-2', fields: { summary } },
        }),
      );
    const entity = stored('issue', 'ACME-2');
    expect(entity.current).toEqual({ key: 'ACME-2', fields: { summary: 'd' } });
    expect(entity.history).toHaveLength(2);
    expect((entity.meta as { version: number }).version).toBe(4);
  });

  it('deletes an issue and reports whether it existed', async () => {
    await jiraDrain(
      deps({ webhookEvent: 'jira:issue_created', issue: { key: 'ACME-3' } }),
    );
    await jiraDrain(
      deps({ webhookEvent: 'jira:issue_deleted', issue: { key: 'ACME-3' } }),
    );
    expect(result()).toMatchObject({ action: 'delete', deleted: true });
    expect(fs.existsSync(path.join(dir, 'issue', 'ACME-3.json'))).toBe(false);
    await jiraDrain(
      deps({ webhookEvent: 'jira:issue_deleted', issue: { key: 'ACME-3' } }),
    );
    expect(result()).toMatchObject({ deleted: false });
  });

  it('stores a comment with its issue key, then deletes it', async () => {
    await jiraDrain(
      deps({
        webhookEvent: 'comment_created',
        comment: { id: '10', body: 'hi' },
        issue: { key: 'ACME-4' },
      }),
    );
    expect(stored('comment', '10').current).toEqual({
      id: '10',
      body: 'hi',
      _issueKey: 'ACME-4',
    });
    await jiraDrain(
      deps({ webhookEvent: 'comment_updated', comment: { id: '11' } }),
    );
    expect(stored('comment', '11').current).toEqual({ id: '11' });
    await jiraDrain(
      deps({ webhookEvent: 'comment_deleted', comment: { id: '10' } }),
    );
    expect(result()).toEqual({
      event: 'comment_deleted',
      action: 'delete',
      type: 'comment',
      key: '10',
      deleted: true,
    });
  });

  it.each([
    ['jira:version_created', 'version', 'upsert'],
    ['jira:version_deleted', 'version', 'delete'],
    ['sprint_updated', 'sprint', 'upsert'],
    ['sprint_deleted', 'sprint', 'delete'],
    ['board_created', 'board', 'upsert'],
    ['board_deleted', 'board', 'delete'],
  ])('routes %s to %s (%s)', async (event, type, action) => {
    await jiraDrain(deps({ webhookEvent: event, [type]: { id: 7 } }));
    expect(result()).toMatchObject({ event, action, type, key: 7 });
  });

  it('writes an unknown event to _unmatched', async () => {
    await jiraDrain(deps({ webhookEvent: 'worklog_created', x: 1 }));
    expect(result()).toEqual({ event: 'worklog_created', action: 'unmatched' });
    const files = fs.readdirSync(path.join(dir, '_unmatched'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/-worklog_created\.json$/);
  });

  it.each([
    [{}, 'No webhookEvent in payload'],
    [{ webhookEvent: 'jira:issue_created', issue: {} }, 'No issue key'],
    [{ webhookEvent: 'jira:issue_deleted' }, 'No issue key'],
    [{ webhookEvent: 'comment_created', comment: { id: '' } }, 'No comment id'],
    [
      { webhookEvent: 'sprint_created', sprint: { id: null } },
      'No sprint id in payload',
    ],
  ])('rejects %j: %s', async (body, message) => {
    await expect(jiraDrain(deps(body))).rejects.toThrow(message);
    expect(lines).toEqual([]);
  });
});

describe('jiraRoute', () => {
  it('has no route for an unknown event', () => {
    expect(jiraRoute('issuelink_created', {})).toBeUndefined();
  });
});

describe('jiraDrainDeps', () => {
  it('resolves the domain directory and limits from config at run time', () => {
    const live = jiraDrainDeps();
    expect(path.basename(live.domainDir)).toBe('jira');
    expect(live.fieldsFilename).toBe('_fields.json');
    expect(live.maxHistory).toBe(50);
    expect(live.now()).toMatch(/^\d{4}-/);
  });
});

describe('loadFieldMap', () => {
  it('is empty when the file is missing or not JSON', () => {
    expect(loadFieldMap(dir, '_fields.json')).toEqual({});
    fs.writeFileSync(path.join(dir, '_fields.json'), '{nope');
    expect(loadFieldMap(dir, '_fields.json')).toEqual({});
  });
});
