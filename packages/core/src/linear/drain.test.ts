import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { linearDrain, type LinearDrainDeps, linearDrainDeps } from './drain.js';

let dir: string;
let lines: string[];

const deps = (body: unknown): LinearDrainDeps => ({
  domainDir: dir,
  maxHistory: 50,
  readBody: () => Promise.resolve(body as Record<string, unknown>),
  now: () => '2026-01-01T00:00:00.000Z',
  log: (line) => lines.push(line),
});

const stored = (type: string, key: string): Record<string, unknown> =>
  JSON.parse(
    fs.readFileSync(path.join(dir, type, `${key}.json`), 'utf8'),
  ) as Record<string, unknown>;

const result = (): Record<string, unknown> =>
  JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linear-drain-'));
  lines = [];
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('linearDrain', () => {
  it('upserts then removes an issue by identifier', async () => {
    await linearDrain(
      deps({
        action: 'create',
        type: 'Issue',
        data: { identifier: 'ACME-1', title: 't' },
      }),
    );
    expect(result()).toEqual({
      action: 'create',
      type: 'Issue',
      entityAction: 'upsert',
      entityType: 'issue',
      key: 'ACME-1',
      path: path.join(dir, 'issue', 'ACME-1.json'),
    });
    expect(stored('issue', 'ACME-1').current).toEqual({
      identifier: 'ACME-1',
      title: 't',
    });
    await linearDrain(
      deps({ action: 'remove', type: 'Issue', data: { identifier: 'ACME-1' } }),
    );
    expect(result()).toEqual({
      action: 'remove',
      type: 'Issue',
      entityAction: 'delete',
      entityType: 'issue',
      key: 'ACME-1',
      deleted: true,
    });
  });

  it('enriches a comment with its issue identifier, then removes it', async () => {
    await linearDrain(
      deps({
        action: 'update',
        type: 'Comment',
        data: { id: 'c1', body: 'hi', issue: { identifier: 'ACME-2' } },
      }),
    );
    expect(stored('comment', 'c1').current).toMatchObject({
      id: 'c1',
      _issueIdentifier: 'ACME-2',
    });
    await linearDrain(
      deps({ action: 'remove', type: 'Comment', data: { id: 'c1' } }),
    );
    expect(result()).toMatchObject({ entityAction: 'delete', deleted: true });
  });

  it.each([
    ['Cycle', 'cycle', { number: 0 }, 0],
    ['Project', 'project', { id: 'p1' }, 'p1'],
    ['IssueLabel', 'label', { id: 'l1' }, 'l1'],
  ])('upserts a %s even on remove', async (type, entityType, data, key) => {
    await linearDrain(deps({ action: 'remove', type, data }));
    expect(result()).toMatchObject({ entityAction: 'upsert', entityType, key });
    expect(stored(entityType, String(key)).current).toEqual(data);
  });

  it('writes an unknown type to _unmatched under action-type', async () => {
    await linearDrain(deps({ action: 'create', type: 'Reaction', data: {} }));
    expect(result()).toEqual({
      action: 'create',
      type: 'Reaction',
      entityAction: 'unmatched',
    });
    expect(fs.readdirSync(path.join(dir, '_unmatched'))[0]).toMatch(
      /-create-Reaction\.json$/,
    );
  });

  it.each([
    [{ type: 'Issue' }, 'Missing action or type in payload'],
    [{ action: 'create' }, 'Missing action or type in payload'],
    [
      { action: 'create', type: 'Issue', data: {} },
      'No issue identifier in payload',
    ],
    [{ action: 'create', type: 'Comment' }, 'No comment id in payload'],
    [
      { action: 'create', type: 'Cycle', data: { number: '' } },
      'No cycle number in payload',
    ],
    [
      { action: 'create', type: 'Project', data: {} },
      'No project id in payload',
    ],
    [
      { action: 'create', type: 'IssueLabel', data: {} },
      'No label id in payload',
    ],
  ])('rejects %j: %s', async (body, message) => {
    await expect(linearDrain(deps(body))).rejects.toThrow(message);
    expect(lines).toEqual([]);
  });
});

describe('linearDrainDeps', () => {
  it('resolves the domain directory and history limit from config', () => {
    const live = linearDrainDeps();
    expect(path.basename(live.domainDir)).toBe('linear');
    expect(live.maxHistory).toBe(50);
  });
});
