/**
 * `transcripts-fetch-video`: on demand (no manifest), `--help` without a
 * network call, the key from the environment, one JSON line on stdout
 * and the exit code.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  config: { libraryDir: '', scratchDir: '', userAgent: 'jeeves-scripts/acme' },
}));
vi.mock('../config/transcripts.js', () => ({
  transcriptsConfig: () => mocks.config,
}));

import { jobHelp } from '../cli/list.js';
import { formatJobHelp } from '../runnables/job-help.js';
import job from './fetch-video.js';
import { PROTOTYPE_RESPONSE } from './lib/render-markdown.fixtures.js';

const ID = 'dQw4w9WgXcQ';
let lines: string[];
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'yt-job-'));
  mocks.config.libraryDir = join(root, 'lib');
  mocks.config.scratchDir = join(root, 'scratch');
  lines = [];
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('TRANSCRIPT_API_KEY', '');
  process.exitCode = undefined;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
});

describe('transcripts-fetch-video runnable', () => {
  it('is an on-demand transcripts runnable with a description and the declared flags', () => {
    expect(job.id).toBe('transcripts-fetch-video');
    expect(job.domain).toBe('transcripts');
    expect(job.positionals).toBe('<video-url-or-id>');
    expect(Object.keys(job.flags ?? {}).sort()).toEqual([
      'dir',
      'force',
      'keep',
      'live',
      'out',
    ]);
  });

  it('prints help with the usage and every flag, and no manifest, without a network call', async () => {
    const help = formatJobHelp(job, undefined);
    expect(help.split('\n')[0]).toBe(
      'Usage: jeeves-scripts run transcripts-fetch-video [options] <video-url-or-id>',
    );
    expect(help).toContain('Manifest:\n  (none: not scheduled)');
    for (const flag of ['--keep', '--dir', '--out', '--force', '--live'])
      expect(help).toContain(flag);
    const viaCli = await jobHelp(
      mkdtempSync(join(tmpdir(), 'yt-root-')),
      job.id,
    );
    expect(viaCli).toBe(help);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exits 4 with one JSON line when there is no key and no cache', async () => {
    await job.run({ args: [ID, '--live'] });
    expect(lines).toEqual([
      '{"ok":false,"error":"TRANSCRIPT_API_KEY is not set"}',
    ]);
    expect(process.exitCode).toBe(4);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the environment key and the configured User-Agent, and exits 0', async () => {
    vi.stubEnv('TRANSCRIPT_API_KEY', 'tk-env');
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(PROTOTYPE_RESPONSE), { status: 200 }),
    );
    await job.run({ args: [`https://youtu.be/${ID}`] });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      Authorization: 'Bearer tk-env',
      'User-Agent': 'jeeves-scripts/acme',
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      ok: true,
      dryRun: true,
      path: join(mocks.config.scratchDir, `${ID}.md`),
    });
    expect(process.exitCode).toBeUndefined();
  });

  it('passes --keep, --dir and --force through, reading a valued --dir as no positional', async () => {
    mkdirSync(mocks.config.scratchDir, { recursive: true });
    writeFileSync(
      join(mocks.config.scratchDir, `${ID}.json`),
      JSON.stringify(PROTOTYPE_RESPONSE),
    );
    const dir = join(mocks.config.libraryDir, 'other');
    await job.run({ args: [ID, '--dir', dir] });
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      ok: true,
      kept: true,
      cached: true,
    });
    expect(
      (JSON.parse(lines[0] ?? '') as { path: string }).path.startsWith(dir),
    ).toBe(true);
  });
});
