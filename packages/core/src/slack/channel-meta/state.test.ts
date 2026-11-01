/**
 * Tests for the job state: a missing file is empty, an unreadable or
 * invalid one fails loudly, saves round-trip, and comparisons and the report hash ignore
 * Slack's escaping and whitespace.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  emptyState,
  hashText,
  loadState,
  normalizeSlackText,
  saveState,
} from './state.js';

let root = '';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-meta-state-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('state file', () => {
  it('is empty when missing and round-trips through save', () => {
    const file = path.join(root, 'deep', 'state.json');
    expect(loadState(file)).toEqual(emptyState());
    const state = {
      ...emptyState(),
      reportHash: 'r',
      channels: {
        C1: {
          sweptTs: '1.000001',
          assignment: { ts: '1.000001', path: 'J:/a' },
          topic: {
            generatedAt: '2026-10-21T00:00:00.000Z',
            lastMessageTs: '1.000001',
            checkedAt: '2026-10-22T00:00:00.000Z',
          },
        },
      },
    };
    saveState(file, state);
    expect(loadState(file)).toEqual(state);
  });

  it('fails on a file it can\u2019t read, rather than starting empty', () => {
    const dir = path.join(root, 'state.json');
    fs.mkdirSync(dir);
    expect(() => loadState(dir)).toThrow(
      expect.objectContaining({ code: 'EISDIR' }),
    );
  });

  it.each([
    'not json',
    '{"version":2,"channels":{}}',
    '{"version":1}',
    '{"version":1,"channels":{"C1":{"topic":{"generatedAt":"x"}}}}',
  ])('fails on invalid state %s', (text) => {
    const file = path.join(root, 'state.json');
    fs.writeFileSync(file, text);
    expect(() => loadState(file)).toThrow(
      'is not valid slack-refresh-channel-meta state',
    );
  });
});

describe('hashText', () => {
  it('ignores entities and whitespace, not wording', () => {
    expect(normalizeSlackText('  a &amp; b\n&lt;c&gt;  ')).toBe('a & b <c>');
    expect(hashText('a & b')).toBe(hashText(' a &amp;  b '));
    expect(hashText('a & b')).not.toBe(hashText('a and b'));
  });
});
