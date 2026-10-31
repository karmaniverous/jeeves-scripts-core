/**
 * Tests for run directories: UTC run ids and pruning old runs.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pruneRuns, runId } from './run-dirs.js';

let root = '';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-dirs-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('runId and pruneRuns', () => {
  it('names runs by UTC time', () => {
    expect(runId(new Date('2026-10-20T09:08:07.654Z'))).toBe('20261020-090807');
  });

  it('keeps the newest runs and ignores other entries', () => {
    for (const n of [
      '20261018-000000',
      '20261019-000000',
      '20261020-000000',
      'keep-me',
    ])
      fs.mkdirSync(path.join(root, n));
    expect(pruneRuns(root, 2)).toEqual(['20261018-000000']);
    expect(fs.readdirSync(root).sort()).toEqual([
      '20261019-000000',
      '20261020-000000',
      'keep-me',
    ]);
  });

  it('does nothing when the root does not exist', () => {
    expect(pruneRuns(path.join(root, 'missing'), 1)).toEqual([]);
  });
});
