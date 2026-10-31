/**
 * Tests for the report file (Markdown): workspace lines with scopes, the
 * sweep's `config set` commands (Decision 66) and findings, coverage lists, description/topic
 * outcomes with generated texts, skip counts, worker problems,
 * unreadable channels and escaping. It never carries a channel's raw
 * messages, current values or meta.
 */

import { describe, expect, it } from 'vitest';

import {
  channel,
  FRESH as fresh,
  reportFacts as facts,
  reportInput as input,
  SECRETS,
  workspace,
} from './fakes.test-helper.js';
import { homeDirCommand, reportBody, reportMarkdown } from './report.js';
import { mdText } from './report-md.js';

const noSecrets = (text: string): void => {
  for (const s of SECRETS) expect(text).not.toContain(s);
};

describe('homeDirCommand', () => {
  it.each([
    ['J:/acme', 'J:/acme'],
    ['/opt/my docs', '"/opt/my docs"'],
    ["/opt/o'brien", '"/opt/o\'brien"'],
    ['/opt/a"b', '"/opt/a\\"b"'],
  ])('quotes %s only when the shell needs it', (dir, arg) => {
    expect(homeDirCommand('C0AB', dir)).toBe(
      `jeeves-scripts config set slack.channels.C0AB.homeDir ${arg}`,
    );
  });
});

describe('mdText', () => {
  it('escapes Markdown and collapses whitespace', () => {
    expect(mdText('a *b* _c_ `d` [e](f) <g> | # ~ \\\n h')).toBe(
      'a \\*b\\* \\_c\\_ \\`d\\` \\[e\\](f) \\<g\\> \\| \\# \\~ \\\\ h',
    );
  });
});

describe('reportBody', () => {
  it('reports workspaces, an empty sweep, full coverage and no changes', () => {
    const body = reportBody(input());
    expect(body).toContain(
      '## Workspaces\n\n- `default` (Acme & Co): 1 member channel(s)',
    );
    expect(body).toContain('## Home-directory sweep\n\nNo new assignments.');
    expect(body).toContain(
      '## Coverage\n\nEvery member channel has a home directory with a seeded meta.',
    );
    expect(body).toContain(
      '## Descriptions\n\n- Up to date (nothing new since last generated): 1',
    );
    noSecrets(body);
  });

  it('says No changes when a field has nothing to list', () => {
    const body = reportBody(input({ facts: [] }));
    expect(body).toContain('## Descriptions\n\nNo changes.');
    expect(body).toContain('## Topics\n\nNo changes.');
  });

  it('names missing, unknown scopes and unread workspaces', () => {
    const body = reportBody(
      input({
        workspaces: [
          workspace('globex', [], { scopes: ['channels:read', 'groups:read'] }),
          workspace('x', []),
          workspace('y', [], { error: 'Slack auth.test failed: invalid_auth' }),
        ],
      }),
    );
    expect(body).toContain(
      '- `globex`: 0 member channel(s), missing scopes `channels:write.topic`, `groups:write.topic`',
    );
    expect(body).toContain('- `x`: 0 member channel(s), scopes unknown');
    expect(body).toContain(
      '- `y`: not read: `Slack auth.test failed: invalid_auth`',
    );
  });

  it('proposes the exact config set command, and lists mismatches and missing directories', () => {
    const body = reportBody(
      input({
        facts: [
          facts('C1', {
            homeDir: undefined,
            finding: { kind: 'proposal', path: 'J:/a' },
          }),
          facts('C2', {
            homeDir: undefined,
            finding: { kind: 'proposal', path: '/opt/my docs/b' },
          }),
          facts('C3', {
            finding: {
              kind: 'mismatch',
              path: 'J:/x',
              configured: 'J:/y',
              exists: false,
            },
          }),
          facts('C4', {
            finding: {
              kind: 'mismatch',
              path: 'J:/p',
              configured: 'J:/q',
              exists: true,
            },
          }),
          facts('C5', {
            homeDir: undefined,
            finding: { kind: 'missing-dir', path: 'J:/gone' },
          }),
        ],
      }),
    );
    expect(body).toContain(
      [
        'Proposed home directories (2); review each, run it, then run it again with `--live` to write the config:',
        '',
        '```bash',
        'jeeves-scripts config set slack.channels.C1.homeDir J:/a',
        'jeeves-scripts config set slack.channels.C2.homeDir "/opt/my docs/b"',
        '```',
      ].join('\n'),
    );
    expect(body).not.toContain('```json');
    expect(body).toContain(
      '- #c3 (`C3`): posted `J:/x` (missing on disk), configured `J:/y`',
    );
    expect(body).toContain('- #c4 (`C4`): posted `J:/p`, configured `J:/q`');
    expect(body).toContain(
      '**Assigned directories missing on disk** (1):\n\n- #c5 (`C5`): `J:/gone`',
    );
  });

  it('lists coverage gaps', () => {
    const body = reportBody(
      input({
        facts: [
          facts('C1', { homeDir: undefined }),
          facts('C2', { homeDirExists: false }),
          facts('C3', { meta: undefined }),
        ],
      }),
    );
    expect(body).toContain('**No home directory** (1):\n\n- #c1 (`C1`)');
    expect(body).toContain(
      '**Home directory missing on disk** (1):\n\n- #c2 (`C2`): `/h/C2`',
    );
    expect(body).toContain(
      '**No seeded meta (`.meta/meta.json`)** (1):\n\n- #c3 (`C3`): `/h/C3`',
    );
  });

  it('lists field outcomes with generated texts, scopes and counts', () => {
    const body = reportBody(
      input({
        facts: [
          facts('C1'),
          facts('C2', {
            plans: {
              description: { action: 'skip', reason: 'missing-scope' },
              topic: { action: 'skip', reason: 'quiet' },
            },
          }),
          facts('C3', {
            plans: {
              description: fresh,
              topic: { action: 'skip', reason: 'quiet' },
            },
          }),
        ],
        outcomes: [
          {
            id: 'C1',
            field: 'description',
            status: 'updated',
            text: 'About *C1*',
          },
          { id: 'C2', field: 'description', status: 'unchanged', text: 'Same' },
          {
            id: 'C1',
            field: 'topic',
            status: 'failed',
            detail: 'missing_scope',
            text: 'Now',
          },
          {
            id: 'C2',
            field: 'topic',
            status: 'rejected',
            detail: 'too <long>',
          },
          { id: 'C3', field: 'topic', status: 'deferred' },
          { id: 'C9', field: 'topic', status: 'updated' },
        ],
      }),
    );
    expect(body).toContain(
      '**Updated** (1):\n\n- #c1 (`C1`) \u2014 \u201cAbout \\*C1\\*\u201d',
    );
    expect(body).toContain(
      '**Generated, already current (not written)** (1):\n\n- #c2 (`C2`) \u2014 \u201cSame\u201d',
    );
    expect(body).toContain(
      '**Failed** (1):\n\n- #c1 (`C1`): missing\\_scope \u2014 \u201cNow\u201d',
    );
    expect(body).toContain(
      '**Worker value rejected** (1):\n\n- #c2 (`C2`): too \\<long\\>',
    );
    expect(body).toContain(
      '**Waiting for a later run (batch cap)** (1):\n\n- #c3 (`C3`)',
    );
    expect(body).toContain(
      '**Left alone: the bot lacks the write scope** (1):\n\n- #c2 (`C2`)',
    );
    expect(body).toContain(
      '- Quiet (no human posts in the window, nothing new), left alone: 2',
    );
    expect(body).not.toContain('C9');
    noSecrets(body);
  });

  it('says when a field is switched off', () => {
    const body = reportBody(
      input({ enabled: { description: false, topic: true } }),
    );
    expect(body).toContain('## Descriptions\n\nSwitched off: report only.');
  });

  it('reports a worker problem and unreadable channels', () => {
    const body = reportBody(
      input({
        workerProblem: 'the worker wrote no result',
        facts: [facts('C1', { readError: 'Slack x failed: missing_scope' })],
      }),
    );
    expect(body).toContain(
      '## Worker\n\nNo values set: the worker wrote no result',
    );
    expect(body).toContain(
      '## Messages unreadable\n\n**No archive, and history refused** (1):\n\n- #c1 (`C1`): `Slack x failed: missing_scope`',
    );
    expect(body).not.toContain('Sweep incomplete');
  });

  it('reports an incomplete sweep on its own', () => {
    const body = reportBody(
      input({
        facts: [
          facts('C1', {
            sweepNotes: ['history cut at 25 pages: sweep position kept'],
          }),
        ],
      }),
    );
    expect(body).toContain(
      '## Messages unreadable\n\n**Sweep incomplete** (1):\n\n- #c1 (`C1`): history cut at 25 pages: sweep position kept',
    );
    expect(body).not.toContain('history refused');
  });

  it('escapes channel and team names', () => {
    const body = reportBody(
      input({
        workspaces: [workspace('default', [], { team: '*Bold* team' })],
        facts: [
          facts('C1', {
            channel: channel('C1', { name: 'a_b' }),
            homeDir: undefined,
          }),
        ],
      }),
    );
    expect(body).toContain('(\\*Bold\\* team)');
    expect(body).toContain('#a\\_b (`C1`)');
  });
});

describe('reportMarkdown', () => {
  it('adds the dated heading', () => {
    expect(reportMarkdown(input(), 'BODY')).toBe(
      '# Slack channel descriptions, topics and home directories (2026-10-22)\n\nBODY\n',
    );
  });
});
