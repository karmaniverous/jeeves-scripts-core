import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyDelta,
  effectiveManifests,
  type JobManifest,
  readCoreManifests,
} from './manifest.js';

const base: JobManifest = {
  id: 'acme-poll',
  domain: 'acme',
  name: 'Acme Poll',
  description: 'Polls Acme.',
  schedule: { freq: 'minutely', interval: 5, timezone: 'UTC' },
  args: ['--quiet'],
  env: { A: '1', B: '2' },
  overlap_policy: 'skip',
  timeout_seconds: 300,
  enabled: true,
  prerequisite: null,
};

describe('readCoreManifests (shipped)', () => {
  it('reads every core manifest: ids unique, no script paths', () => {
    const manifests = readCoreManifests();
    expect(new Set(manifests.map((m) => m.id)).size).toBe(manifests.length);
    for (const m of manifests) expect(m).not.toHaveProperty('script');
  });
});

describe('readCoreManifests (fixtures)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-manifest-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (name: string, content: unknown): void => {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(content));
  };
  const { id: _id, domain: _domain, ...entry } = base;

  it('keys entries by id and takes the domain from the file name', () => {
    write('acme.json', { 'acme-poll': entry });
    write('notes.txt', 'ignored');
    expect(readCoreManifests(dir)).toEqual([base]);
  });

  it('fails on an invalid entry, naming the file', () => {
    write('acme.json', {
      'acme-poll': { ...entry, script: 'src/acme/poll.ts' },
    });
    expect(() => readCoreManifests(dir)).toThrow(
      /[\\/]acme\.json[\s\S]*script/,
    );
  });

  it('fails on a schedule the runner rejects, with its message', () => {
    write('acme.json', {
      'acme-poll': { ...entry, schedule: { freq: 'hourly', interval: 4 } },
    });
    expect(() => readCoreManifests(dir)).toThrow(
      /[\\/]acme\.json[\s\S]*Invalid RRStack schedule[\s\S]*timezone/,
    );
  });

  it('accepts a cron schedule', () => {
    write('acme.json', {
      'acme-poll': { ...entry, schedule: '17 */6 * * *' },
    });
    expect(readCoreManifests(dir)[0]?.schedule).toBe('17 */6 * * *');
  });

  it('accepts an entry without a timeout (none, as in the runner)', () => {
    const { timeout_seconds: _timeout, ...untimed } = entry;
    write('acme.json', { 'acme-poll': untimed });
    expect(readCoreManifests(dir)[0]).not.toHaveProperty('timeout_seconds');
  });

  it('names the file and the position on a JSON syntax error', () => {
    fs.writeFileSync(path.join(dir, 'acme.json'), '{ "acme-poll": { ,} }');
    expect(() => readCoreManifests(dir)).toThrow(
      /^Invalid JSON in job manifest .*[\\/]acme\.json: .*position \d+/,
    );
  });

  it('fails on an id in two files', () => {
    write('acme.json', { 'acme-poll': entry });
    write('other.json', { 'acme-poll': entry });
    expect(() => readCoreManifests(dir)).toThrow(
      /"acme-poll" is in both .*acme\.json and .*other\.json\./,
    );
  });
});

describe('applyDelta', () => {
  it('returns the manifest unchanged without a delta', () => {
    expect(applyDelta(base, undefined)).toBe(base);
    expect(applyDelta(base, {})).toEqual(base);
  });

  it('replaces enabled, timeout and schedule; merges env; appends args', () => {
    const schedule = { freq: 'daily', byhour: 6, timezone: 'UTC' };
    expect(
      applyDelta(base, {
        enabled: false,
        timeout_seconds: 60,
        schedule,
        env: { B: 'b', C: '3' },
        args: ['--live'],
      }),
    ).toEqual({
      ...base,
      enabled: false,
      timeout_seconds: 60,
      schedule,
      env: { A: '1', B: 'b', C: '3' },
      args: ['--quiet', '--live'],
    });
  });

  it('adds env and args to a manifest that has none', () => {
    const { env: _env, args: _args, ...bare } = base;
    expect(applyDelta(bare, { env: { A: 'x' }, args: ['y'] })).toEqual({
      ...bare,
      env: { A: 'x' },
      args: ['y'],
    });
  });

  it('ignores delta fields that are not runner fields (silo, taskFile)', () => {
    expect(applyDelta(base, { silo: 'acme', taskFile: 'a/TASK.md' })).toEqual(
      base,
    );
  });
});

describe('effectiveManifests', () => {
  const other: JobManifest = { ...base, id: 'acme-push' };

  it('applies each delta to its job only', () => {
    const result = effectiveManifests({
      manifests: [base, other],
      deltas: { 'acme-push': { enabled: false } },
      knownIds: new Set(['acme-poll', 'acme-push']),
    });
    expect(result).toEqual([base, { ...other, enabled: false }]);
  });

  it('accepts a delta for a known job without a manifest (an instance or manual job)', () => {
    expect(
      effectiveManifests({
        manifests: [base],
        deltas: { 'acme-drain': { silo: 'acme' } },
        knownIds: new Set(['acme-poll', 'acme-drain']),
      }),
    ).toEqual([base]);
  });

  it('fails on runner fields in a delta for a runnable without a manifest', () => {
    expect(() =>
      effectiveManifests({
        manifests: [base],
        deltas: {
          'acme-drain': { schedule: '0 * * * *' },
          'acme-pull': { enabled: false, silo: 'acme' },
          'acme-ok': { taskFile: 'a/TASK.md' },
        },
        knownIds: new Set(['acme-poll', 'acme-drain', 'acme-pull', 'acme-ok']),
      }),
    ).toThrow(
      /enabled\/schedule\/timeout_seconds\/env\/args on runnable id\(s\) with no manifest, where they have no effect: acme-drain, acme-pull\./,
    );
  });

  it('fails on deltas for unknown runnable ids, listing them', () => {
    expect(() =>
      effectiveManifests({
        manifests: [base],
        deltas: { nope: { enabled: false }, gone: {}, 'acme-poll': {} },
        knownIds: new Set(['acme-poll']),
      }),
    ).toThrow(/unknown runnable id\(s\): nope, gone/);
  });
});
