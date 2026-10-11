import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeRunnerClient } from '../../lib/fake-runner-client.test-helper.js';
import { seenKey } from '../email-state.js';
import { emailInventory, inventoryDeps } from './inventory.js';

let dir: string;
let lines: string[];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-'));
  lines = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    lines.push(a.map(String).join(' '));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('emailInventory', () => {
  it('counts thread directories, message files and seen threads per account', () => {
    const base = path.join(dir, 'acme', 'email');
    const threads = path.join(base, 'threads', 'me@example.com');
    fs.mkdirSync(path.join(threads, 't1'), { recursive: true });
    fs.mkdirSync(path.join(threads, 't2'), { recursive: true });
    fs.writeFileSync(path.join(threads, 't1', 'm1.json'), '{}');
    fs.writeFileSync(path.join(threads, 't1', 'm2.json'), '{}');
    fs.writeFileSync(path.join(threads, 'stray.json'), '{}');
    const runner = fakeRunnerClient();
    runner.client.setItem('email', seenKey('me@example.com'), 't1', '1');
    emailInventory({
      accounts: () => ['me@example.com', 'none@example.com'],
      emailBase: (a) =>
        a === 'me@example.com' ? base : path.join(dir, 'other', 'email'),
      runner: () => runner.client,
    });
    const me = lines.find((l) => l.includes('me@example.com')) ?? '';
    expect(me.startsWith('acme')).toBe(true);
    expect(me.trim().split(/\s+/).slice(-3)).toEqual(['2', '2', '1']);
    expect(
      lines
        .find((l) => l.startsWith('TOTAL'))
        ?.trim()
        .split(/\s+/),
    ).toEqual(['TOTAL', '2', '2', '1']);
    expect(runner.closed()).toBe(true);
  });
});

describe('inventoryDeps', () => {
  it('reads the accounts from config', () => {
    expect(inventoryDeps().accounts()).toEqual([]);
  });
});
