/**
 * Tests for the Slack summary: per-field counts, numbers and the link
 * only (no channel names, ids, paths, texts or content), plurals, a
 * worker problem, switched-off fields and the preview line.
 */

import { describe, expect, it } from 'vitest';

import {
  ALL_SCOPES,
  channel,
  FRESH as fresh,
  reportFacts as facts,
  reportInput as input,
  SECRETS,
  workspace,
} from './fakes.test-helper.js';
import type { ReportInput } from './report-input.js';
import { fieldCounts, summaryPost } from './summary.js';

const LINK = '<https://jeeves.example/r|report>';

describe('fieldCounts', () => {
  it('groups outcomes per field', () => {
    const counts = fieldCounts(
      input({
        facts: [
          facts('C1', {
            plans: {
              description: { action: 'skip', reason: 'missing-scope' },
              topic: fresh,
            },
          }),
        ],
        outcomes: [
          { id: 'C1', field: 'description', status: 'updated' },
          { id: 'C2', field: 'description', status: 'unchanged' },
          { id: 'C3', field: 'description', status: 'deferred' },
          { id: 'C4', field: 'description', status: 'would-update' },
          { id: 'C5', field: 'description', status: 'failed' },
          { id: 'C6', field: 'description', status: 'rejected' },
          { id: 'C8', field: 'description', status: 'proposed' },
          { id: 'C7', field: 'topic', status: 'updated' },
        ],
      }),
      'description',
    );
    expect(counts).toEqual({
      updated: 1,
      proposed: 1,
      unchanged: 1,
      pending: 2,
      failed: 2,
      noScope: 1,
    });
  });
});

describe('summaryPost', () => {
  const rich = (over: Partial<ReportInput> = {}): ReportInput =>
    input({
      workspaces: [
        workspace('default', [channel('C1'), channel('C2')], {
          team: 'Acme <&> Co',
          scopes: ALL_SCOPES,
        }),
        workspace('vc', [channel('C3')], { scopes: ['channels:read'] }),
        workspace('z', [], { error: 'invalid_auth' }),
      ],
      facts: [
        facts('C1', {
          homeDir: undefined,
          finding: { kind: 'proposal', path: '/SECRET/PATH' },
        }),
        facts('C2', { homeDirExists: false, readError: 'boom' }),
        facts('C3', {
          meta: undefined,
          sweepNotes: ['history cut at 25 pages: sweep position kept'],
          finding: {
            kind: 'mismatch',
            path: 'J:/x',
            configured: 'J:/y',
            exists: true,
          },
          plans: {
            description: fresh,
            topic: { action: 'skip', reason: 'missing-scope' },
          },
        }),
      ],
      outcomes: [
        {
          id: 'C1',
          field: 'description',
          status: 'updated',
          text: 'SECRET TEXT',
        },
        { id: 'C2', field: 'description', status: 'deferred' },
        { id: 'C3', field: 'topic', status: 'failed', detail: 'missing_scope' },
      ],
      ...over,
    });

  it('carries only numbers and the link', () => {
    const post = summaryPost(rich(), LINK);
    expect(post).toBe(
      [
        '*Slack channel meta* (2026-10-22)',
        'Member channels: 2 in `default` (Acme &lt;&amp;&gt; Co); 1 in `vc`, 3 missing scopes; `z` not read',
        'Home directories: 1 missing, 1 missing on disk, 1 unseeded meta',
        'Sweep: 1 proposal, 1 mismatch, 0 assigned missing on disk',
        'Descriptions: 1 updated, 0 unchanged, 1 pending, 0 failed',
        'Topics: 0 updated, 0 unchanged, 0 pending, 1 failed, 1 without write scope',
        'Unreadable channels: 1',
        'Sweep incomplete: 1 channel',
        `Report: ${LINK}`,
      ].join('\n'),
    );
    for (const s of [...SECRETS, 'SECRET TEXT', '/SECRET/PATH', '#c1', 'C1'])
      expect(post).not.toContain(s);
  });

  it('pluralises, flags a worker problem and shows switched-off fields', () => {
    const post = summaryPost(
      input({
        workspaces: [
          workspace('default', [], {
            scopes: ['channels:read', 'groups:read', 'channels:write.topic'],
          }),
        ],
        facts: [
          facts('C1', {
            meta: undefined,
            finding: { kind: 'proposal', path: 'J:/a' },
          }),
          facts('C2', {
            meta: undefined,
            finding: { kind: 'proposal', path: 'J:/b' },
          }),
          facts('C3', {
            finding: {
              kind: 'mismatch',
              path: 'J:/a',
              configured: 'J:/b',
              exists: true,
            },
          }),
          facts('C4', {
            finding: {
              kind: 'mismatch',
              path: 'J:/a',
              configured: 'J:/b',
              exists: true,
            },
          }),
          facts('C5', {
            homeDir: undefined,
            finding: { kind: 'missing-dir', path: 'J:/c' },
          }),
        ],
        enabled: { description: true, topic: false },
        workerProblem: 'bad result',
      }),
      LINK,
    );
    expect(post).toContain('0 in `default`, 1 missing scope');
    expect(post).toContain('2 unseeded metas');
    expect(post).toContain(
      'Sweep: 2 proposals, 2 mismatches, 1 assigned missing on disk',
    );
    expect(post).toContain('Topics: off (report only)');
    expect(post).toContain('Worker result unusable: no values set');
    expect(post).not.toContain('bad result');
    expect(post).not.toContain('Unreadable');
  });

  it('says preview and counts what was proposed instead of updated', () => {
    const post = summaryPost(
      rich({
        preview: true,
        outcomes: [
          { id: 'C1', field: 'description', status: 'would-update' },
          { id: 'C2', field: 'description', status: 'deferred' },
          { id: 'C3', field: 'description', status: 'proposed' },
          { id: 'C4', field: 'description', status: 'proposed' },
          { id: 'C5', field: 'description', status: 'updated' },
          { id: 'C6', field: 'description', status: 'unchanged' },
          { id: 'C7', field: 'description', status: 'rejected' },
        ],
      }),
      LINK,
    );
    expect(post.split('\n')[0]).toBe(
      '*Slack channel meta* (2026-10-22) \u2014 preview: nothing set',
    );
    expect(post).toContain(
      'Descriptions: 2 proposed, 1 unchanged, 2 pending, 1 failed\n',
    );
    expect(post).toContain(
      'Topics: 0 proposed, 0 unchanged, 0 pending, 0 failed, 1 without write scope',
    );
  });
});
