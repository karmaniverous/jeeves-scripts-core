import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeRunnerClient } from '../../lib/fake-runner-client.test-helper.js';
import {
  type DocFetchDeps,
  fetchDocContent,
  RATE_LIMIT_MS,
  runDocFetch,
  type SpawnSync,
} from './doc-fetch.js';

let dir: string;
let runner: ReturnType<typeof fakeRunnerClient>;
let logs: string[];
let sleeps: number[];

const meeting = (
  id: string,
  link: string,
  manifest: Record<string, unknown> = {
    meetingId: id,
    source: 'gemini',
    date: '2026-03-02',
    sortTimestampMs: 1,
    sortSource: 'email',
    sources: [{ account: 'me@example.com' }],
  },
) => {
  const mp = path.join(dir, id);
  fs.mkdirSync(mp, { recursive: true });
  fs.writeFileSync(path.join(mp, 'gemini_link.txt'), link);
  fs.writeFileSync(path.join(mp, 'meeting.json'), JSON.stringify(manifest));
  return mp;
};

const deps = (
  exportDoc: DocFetchDeps['exportDoc'] = () => ({ ok: true, content: 'notes' }),
): DocFetchDeps => ({
  meetingsDirs: () => [dir, path.join(dir, 'absent')],
  exportDoc,
  runner: () => runner.client,
  now: () => '2026-03-03T00:00:00.000Z',
  sleep: (ms) => {
    sleeps.push(ms);
    return Promise.resolve();
  },
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-fetch-'));
  runner = fakeRunnerClient();
  logs = [];
  sleeps = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(' '));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('runDocFetch', () => {
  it('has nothing to fetch in an empty tree', async () => {
    await runDocFetch({}, deps());
    expect(logs).toContain('[doc-fetch] Nothing to fetch');
    expect(runner.closed()).toBe(true);
  });

  it('lists what it would fetch in a dry run, capped by --max', async () => {
    meeting('m1', 'https://docs.google.com/document/d/D1/edit');
    meeting('m2', 'https://docs.google.com/document/d/D2/edit');
    await runDocFetch({ dryRun: true, max: 1 }, deps());
    expect(
      logs.filter((l) => l.startsWith('[doc-fetch] WOULD_FETCH')),
    ).toHaveLength(1);
  });

  it('writes transcripts, updates manifest and index, skips bad links and records failures', async () => {
    const ok = meeting('ok', 'https://docs.google.com/document/d/GOOD/edit');
    meeting('nolink', 'not a doc');
    meeting('noacct', 'https://docs.google.com/document/d/X/edit', {
      sources: [],
    });
    meeting('bad', 'https://docs.google.com/document/d/BAD/edit');
    fs.writeFileSync(
      path.join(dir, 'index.json'),
      JSON.stringify({
        meetings: { ok: { hasTranscript: false } },
        updatedAt: null,
      }),
    );
    await runDocFetch(
      {},
      deps((docId) =>
        docId === 'GOOD'
          ? { ok: true, content: 'the notes' }
          : { ok: false, error: 'denied' },
      ),
    );
    expect(fs.readFileSync(path.join(ok, 'transcript.txt'), 'utf8')).toBe(
      'the notes',
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(ok, 'meeting.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      hasTranscript: true,
      artifacts: ['transcript.txt'],
    });
    const index = JSON.parse(
      fs.readFileSync(path.join(dir, 'index.json'), 'utf8'),
    ) as {
      meetings: Record<string, { hasTranscript: boolean }>;
      updatedAt: string;
    };
    expect(index.meetings.ok?.hasTranscript).toBe(true);
    expect(index.updatedAt).toBe('2026-03-03T00:00:00.000Z');
    expect(logs).toContain('[doc-fetch] FAIL BAD: denied');
    expect(logs).toContain('[doc-fetch] Done: 1 fetched, 1 failed, 2 skipped');
    expect(sleeps).toEqual([RATE_LIMIT_MS, RATE_LIMIT_MS]);
    const state = JSON.parse(
      runner.client.getState('meetings', 'fetch-state') ?? '{}',
    ) as Record<string, unknown>;
    expect(state).toMatchObject({ fetched: 1, failed: 1, skipped: 2 });
  });
});

describe('fetchDocContent', () => {
  const spawnReturning =
    (r: Partial<ReturnType<SpawnSync>>): SpawnSync =>
    () => ({
      status: 0,
      stdout: '',
      stderr: '',
      ...r,
    });

  it('reads the file gog reports downloading', () => {
    const file = path.join(dir, 'doc.txt');
    fs.writeFileSync(file, 'doc body');
    expect(
      fetchDocContent(
        'D',
        'a@x.com',
        spawnReturning({ stdout: `path\t${file}\n` }),
      ),
    ).toEqual({
      ok: true,
      content: 'doc body',
    });
  });

  it('fails on a non-zero exit, an unparseable output or a spawn error', () => {
    expect(
      fetchDocContent(
        'D',
        'a',
        spawnReturning({ status: 2, stderr: 'no access' }),
      ),
    ).toEqual({
      ok: false,
      error: 'gog docs export failed (exit 2): no access',
    });
    expect(
      fetchDocContent('D', 'a', spawnReturning({ stdout: 'weird' })),
    ).toEqual({
      ok: false,
      error: 'Could not parse download path from gog output',
    });
    expect(
      fetchDocContent('D', 'a', spawnReturning({ error: new Error('ENOENT') })),
    ).toEqual({
      ok: false,
      error: 'ENOENT',
    });
  });
});
