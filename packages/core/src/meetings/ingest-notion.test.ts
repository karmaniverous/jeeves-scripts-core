/**
 * Tests for the Notion Inbox ingestion with an injected Notion API and page
 * extractor: page selection, dry run, the override file, and the staging,
 * archive copy and Inbox archive of one page.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseRunnableArgs } from '@karmaniverous/jeeves';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ingestNotion,
  type IngestNotionDeps,
  ingestNotionDeps,
  ingestNotionFlags,
} from './ingest-notion.js';
import {
  type NotionInboxDeps,
  processNotionInboxMeeting,
  sha1Prefix,
} from './lib/notion-inbox-processor.js';

const flagsOf = (args: string[]) => parseRunnableArgs(args, ingestNotionFlags);

let dir: string;
let logs: string[];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notion-'));
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(' '));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('ingestNotion', () => {
  const deps = (over: Partial<IngestNotionDeps> = {}): IngestNotionDeps => {
    const key = path.join(dir, 'notion.key');
    fs.writeFileSync(key, 'secret');
    return {
      apiKeyPath: key,
      overridePath: path.join(dir, 'override.txt'),
      inboxDataSourceId: () => 'DS1',
      request: vi.fn(() => Promise.resolve({ results: [{ id: 'oldest' }] })),
      process: vi.fn(() => Promise.resolve()),
      now: () => Date.parse('2026-03-03T12:00:00Z'),
      ...over,
    };
  };

  it('skips without a Notion key', async () => {
    const d = deps({ apiKeyPath: path.join(dir, 'missing') });
    await ingestNotion(flagsOf([]), d);
    expect(logs).toEqual(['[skip] Notion API key not configured']);
  });

  it('processes the oldest Inbox page older than the minimum age', async () => {
    const d = deps();
    await ingestNotion(flagsOf(['--min-age=2']), d);
    expect(d.request).toHaveBeenCalledWith(
      'POST',
      '/v1/data_sources/DS1/query',
      {
        page_size: 1,
        filter: {
          timestamp: 'created_time',
          created_time: { before: '2026-03-03T10:00:00.000Z' },
        },
        sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
      },
    );
    expect(d.process).toHaveBeenCalledWith('oldest');
  });

  it('reports an empty Inbox, as JSON in a dry run', async () => {
    const d = deps({ request: () => Promise.resolve({ results: [] }) });
    await ingestNotion(flagsOf([]), d);
    expect(logs).toEqual(['No inbox meetings found (older than 4h).']);
    logs = [];
    await ingestNotion(flagsOf(['--dry-run']), d);
    expect(JSON.parse(logs[0] ?? '{}')).toEqual({
      skip: true,
      reason: 'No inbox meetings found (older than 4h)',
    });
  });

  it('prints the task in a dry run for a requested page', async () => {
    const d = deps();
    await ingestNotion(flagsOf(['--page-id=P9', '--dry-run']), d);
    expect(JSON.parse(logs[0] ?? '{}')).toMatchObject({
      task: 'Process Notion inbox meeting page P9',
    });
    expect(d.process).not.toHaveBeenCalled();
  });

  it('processes the override page and then removes the override', async () => {
    const d = deps();
    fs.writeFileSync(d.overridePath, 'OVR\n');
    await ingestNotion(flagsOf([]), d);
    expect(d.process).toHaveBeenCalledWith('OVR');
    expect(fs.existsSync(d.overridePath)).toBe(false);
  });
});

describe('processNotionInboxMeeting', () => {
  const page = {
    created_time: '2026-03-01T09:00:00.000Z',
    public_url: 'https://notion.site/x',
    properties: {},
  };
  const deps = (
    tabs: { summary?: string; notes?: string; transcript?: string },
    over: Partial<NotionInboxDeps> = {},
  ): NotionInboxDeps & { calls: [string, string, unknown][] } => {
    const calls: [string, string, unknown][] = [];
    return {
      calls,
      request: (method, p, body) => {
        calls.push([method, p, body]);
        if (method === 'GET') return Promise.resolve(page);
        if (method === 'POST') return Promise.resolve({ id: 'ARCH' });
        return Promise.resolve({});
      },
      extract: () =>
        Promise.resolve({
          h2: 'Weekly Sync @Jane',
          fullText: 'full text',
          tabs: {
            summary: tabs.summary ?? '',
            notes: tabs.notes ?? '',
            transcript: tabs.transcript ?? '',
          },
        }),
      meetingsDir: () => dir,
      archiveDatabaseId: () => 'DB1',
      now: () => '2026-03-03T00:00:00.000Z',
      ...over,
    };
  };

  it('stages the meeting, copies it to the Archive and archives the Inbox page', async () => {
    const d = deps({
      summary: 'sum',
      notes: 'notes',
      transcript: 'x'.repeat(1300),
    });
    await processNotionInboxMeeting('PAGE1', d);
    const meetingDir = path.join(dir, sha1Prefix('PAGE1'));
    expect(
      JSON.parse(
        fs.readFileSync(path.join(meetingDir, 'meeting.json'), 'utf8'),
      ),
    ).toMatchObject({
      source: 'notion-public',
      title: 'Weekly Sync',
      date: '2026-03-01',
      hasTranscript: true,
    });
    expect(fs.readFileSync(path.join(meetingDir, 'summary.txt'), 'utf8')).toBe(
      'sum',
    );
    const index = JSON.parse(
      fs.readFileSync(path.join(dir, 'index.json'), 'utf8'),
    ) as {
      meetings: Record<string, { title: string }>;
    };
    expect(index.meetings[sha1Prefix('PAGE1')]?.title).toBe('Weekly Sync');
    expect(d.calls.map((c) => `${c[0]} ${c[1]}`)).toEqual([
      'GET /v1/pages/PAGE1',
      'POST /v1/pages',
      'PATCH /v1/blocks/ARCH/children',
      'PATCH /v1/pages/PAGE1',
    ]);
    expect(d.calls[1]?.[2]).toMatchObject({ parent: { database_id: 'DB1' } });
    expect(logs.at(-1)).toContain('-> Archive copy ARCH; title="Weekly Sync"');
  });

  it('falls back to the full text for the transcript', async () => {
    const d = deps({});
    await processNotionInboxMeeting('PAGE2', d);
    expect(
      fs.readFileSync(
        path.join(dir, sha1Prefix('PAGE2'), 'transcript.txt'),
        'utf8',
      ),
    ).toBe('full text');
  });

  it('refuses an unpublished page and a page with no text, leaving it in the Inbox', async () => {
    const unpublished = deps(
      {},
      {
        request: () => Promise.resolve({ ...page, public_url: null }),
      },
    );
    await expect(processNotionInboxMeeting('P', unpublished)).rejects.toThrow(
      'Inbox page has no public_url',
    );
    const empty = deps(
      {},
      {
        extract: () =>
          Promise.resolve({
            h2: '',
            fullText: '',
            tabs: { summary: '', notes: '', transcript: '' },
          }),
      },
    );
    await expect(processNotionInboxMeeting('P', empty)).rejects.toThrow(
      'Extraction produced no text',
    );
    expect(empty.calls.map((c) => c[0])).toEqual(['GET']);
  });
});

describe('ingestNotionDeps', () => {
  it('resolves the key and override paths from config', () => {
    const live = ingestNotionDeps();
    expect(live.overridePath).toMatch(/notion-inbox-override\.txt$/);
  });
});
