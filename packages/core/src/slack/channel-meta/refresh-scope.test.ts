/**
 * Tests for where generated text may go: the description and topic
 * sections of the report (live, and the preview without `--live`) name and quote
 * only channels in the report target's own workspace (the account whose
 * bot posts the summary) and count every other workspace's channels;
 * `slack.channelMeta.reportTextAccounts` overrides the list; a target no
 * bot can reach fails a live run before the worker and leaves a preview
 * quoting nothing (or only the configured accounts). Coverage and sweep
 * lists still name every channel; Slack itself is updated in every
 * workspace.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BlockInput } from './fakes.test-helper.js';
import { refreshChannelMeta } from './refresh.js';
import { DRY, LIVE } from './refresh.test-helper.js';
import {
  fieldSections,
  readPreview as previewIn,
  scopeHarness,
  VC_COUNT,
  VC_TEXT,
} from './scope.test-helper.js';

let runsRoot = '';

beforeEach(() => {
  runsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-meta-runs-'));
});

afterEach(() => {
  fs.rmSync(runsRoot, { recursive: true, force: true });
});

const harness = (reach: readonly string[], block: Partial<BlockInput> = {}) =>
  scopeHarness(runsRoot, reach, block);

const readPreview = (): string => previewIn(runsRoot);

describe('refreshChannelMeta: text stays in its workspace', () => {
  it('names and quotes only the report workspace\u2019s channels in a live report, counting the rest, and still updates every workspace', async () => {
    const h = harness(['default']);
    expect(await refreshChannelMeta(LIVE, h.deps)).toBe('posted');
    expect(h.apply.mock.calls.map((c) => [c[0].account, c[1], c[2]])).toEqual([
      ['globex', 'CV1', 'description'],
      ['globex', 'CV1', 'topic'],
      ['globex', 'CV2', 'description'],
      ['globex', 'CV2', 'topic'],
      ['default', 'C1', 'description'],
      ['default', 'C1', 'topic'],
    ]);
    const report = h.delivered[0]?.text ?? '';
    const fields = fieldSections(report);
    expect(fields).toContain(
      '**Updated** (3):\n\n- #one (`C1`) \u2014 \u201cGenerated one text\u201d\n' +
        VC_COUNT,
    );
    expect(fields).toContain(
      '**Updated** (3):\n\n- #one (`C1`) \u2014 \u201cNow one\u201d\n' +
        VC_COUNT,
    );
    for (const s of [...VC_TEXT, 'alpha', 'beta', 'CV1', 'CV2'])
      expect(report).not.toContain(s);
    expect(h.posts).toEqual([
      expect.objectContaining({ target: 'D-default', account: 'default' }),
    ]);
  });

  it('follows the report target: a DM reached by the globex bot shows globex text and counts default', async () => {
    const h = harness(['globex'], { maxChannels: 2 });
    await refreshChannelMeta(LIVE, h.deps);
    const fields = fieldSections(h.delivered[0]?.text ?? '');
    expect(fields).toContain(
      '**Updated** (2):\n\n- #alpha (`CV1`) \u2014 \u201cGenerated alpha text\u201d\n- #beta (`CV2`) \u2014 \u201cGenerated beta text\u201d',
    );
    expect(fields).toContain(
      '**Waiting for a later run (batch cap)** (1):\n\n- 1 channel(s) in `default` (text not shown outside that workspace)',
    );
    expect(fields).not.toContain('#one');
    expect(h.posts[0]?.account).toBe('globex');
  });

  it('keeps every channel in the coverage and sweep lists', async () => {
    const h = harness(['default']);
    h.deps.homeDirOf = (id) => (id === 'C1' ? '/home/C1' : undefined);
    await refreshChannelMeta(LIVE, h.deps);
    const report = h.delivered[0]?.text ?? '';
    expect(report).toContain(
      '**No home directory** (2):\n\n- #alpha (`CV1`)\n- #beta (`CV2`)',
    );
  });

  it.each<[string, string[], string[], string[]]>([
    ['[]', [], [], ['default', 'globex']],
    ['[default, globex]', ['default', 'globex'], ['default', 'globex'], []],
  ])(
    'shows only the accounts in reportTextAccounts (%s)',
    async (_case, configured, shown, hidden) => {
      const h = harness(['default'], {
        reportTextAccounts: configured,
      });
      await refreshChannelMeta(LIVE, h.deps);
      const fields = fieldSections(h.delivered[0]?.text ?? '');
      for (const account of shown)
        expect(fields).not.toContain(`in \`${account}\` (text not shown`);
      for (const account of hidden)
        expect(fields).toContain(`in \`${account}\` (text not shown`);
      expect(fields.includes('Generated alpha text')).toBe(
        shown.includes('globex'),
      );
    },
  );

  it('scopes the dry-run preview the same way, current and proposed alike', async () => {
    const h = harness(['default']);
    expect(await refreshChannelMeta(DRY, h.deps)).toBe('previewed');
    expect(h.apply).not.toHaveBeenCalled();
    expect(h.posts).toEqual([]);
    const report = readPreview();
    expect(fieldSections(report)).toContain(
      '**Proposed (preview: not set)** (3):\n\n- #one (`C1`): empty\n  - current: (empty)\n  - proposed: \u201cGenerated one text\u201d\n' +
        VC_COUNT,
    );
    for (const s of [...VC_TEXT, 'alpha', 'beta'])
      expect(report).not.toContain(s);
    expect(h.logs.join('\n')).toContain('channel text shown for: default):');
  });

  it('fails a live run whose report target no bot can reach, before the worker', async () => {
    const h = harness([]);
    await expect(refreshChannelMeta(LIVE, h.deps)).rejects.toThrow(
      'no Slack bot can reach U0OWNER (default: user_not_found; globex: user_not_found)',
    );
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.saved).toEqual([]);
    expect(h.delivered).toEqual([]);
  });

  it('warns in a preview whose target no bot can reach and quotes only the configured accounts', async () => {
    const h = harness([]);
    await refreshChannelMeta(DRY, h.deps);
    expect(h.logs[0]).toBe(
      "[warn] slack/refresh-channel-meta: no Slack bot can reach U0OWNER (default: user_not_found; globex: user_not_found); the preview names and quotes no workspace's channels but those in slack.channelMeta.reportTextAccounts",
    );
    expect(h.logs.join('\n')).toContain('channel text shown for: none):');
    expect(fieldSections(readPreview())).not.toContain('Generated');

    fs.rmSync(runsRoot, { recursive: true, force: true });
    fs.mkdirSync(runsRoot);
    const configured = harness([], {
      reportTextAccounts: ['globex'],
    });
    await refreshChannelMeta(DRY, configured.deps);
    const fields = fieldSections(readPreview());
    expect(fields).toContain('Generated alpha text');
    expect(fields).not.toContain('Generated one text');
  });
});
