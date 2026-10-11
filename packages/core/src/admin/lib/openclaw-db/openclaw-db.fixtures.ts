/**
 * @module admin/lib/openclaw-db/openclaw-db.fixtures
 *
 * Shared fixtures for the OpenClaw DB collector tests: transcript lines
 * (session header, user message, assistant usage), the fixed hours, a temp
 * root with a one-model rate card (suite hooks), and a bucket reader.
 * Test support only.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, vi } from 'vitest';

import type { HourlyBucket } from '../../types/token-metrics.js';

/** A transcript session header line. */
export const header = (id: string): string =>
  JSON.stringify({ type: 'session', version: 3, id });

/** A transcript user message line. */
export const user = (text: string): string =>
  JSON.stringify({
    type: 'message',
    message: { role: 'user', content: [{ type: 'text', text }] },
  });

/** A transcript assistant line carrying usage. */
export const usage = (tsIso: string, input = 100, output = 50): string =>
  JSON.stringify({
    type: 'message',
    timestamp: tsIso,
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      usage: {
        input,
        output,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: input + output,
      },
    },
  });

/** 10:30 on the fixture day. */
export const T10 = '2026-06-15T10:30:00Z';
/** 11:30 on the fixture day. */
export const T11 = '2026-06-15T11:30:00Z';
/** Milliseconds of an ISO timestamp. */
export const ms = (iso: string): number => new Date(iso).getTime();

/**
 * Suite hooks: a temp root holding `token-rates.json` (one model), console
 * output silenced; returns a getter for the root.
 */
export const useOpenClawDbRoot = (): (() => string) => {
  let root = '';
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-db-scan-'));
    fs.writeFileSync(
      path.join(root, 'token-rates.json'),
      JSON.stringify({
        models: {
          'anthropic/claude-sonnet-4-6': {
            input: 3,
            output: 15,
            cacheRead: 0.3,
            cacheWrite: 3.75,
          },
        },
        updatedAt: '2026-06-15T00:00:00Z',
      }),
    );
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    fs.rmSync(root, { recursive: true, force: true });
  });
  return () => root;
};

/** The input token count of the Sonnet model in one channel of one hour. */
export function inputCount(
  buckets: Map<string, HourlyBucket>,
  hour: string,
  channel: string,
): number {
  return (
    buckets.get(hour)?.channels[channel]?.models['anthropic/claude-sonnet-4-6']
      ?.input.count ?? 0
  );
}
