/**
 * Tests for the Notion I/O edges: the REST client (over a stubbed fetch and
 * a temp key file) and the published-page reader (over a scripted gateway
 * browser tool).
 */

import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { constants } from '../../lib/constants.js';
import { fakeFetch } from '../../lib/fake-fetch.test-helper.js';
import { useTempConfig } from '../../lib/temp-config.test-helper.js';
import { notionRequest } from './notion-api.js';
import {
  type BrowserDeps,
  extractFromPublicPage,
} from './notion-browser-extract.js';

useTempConfig();

describe('notionRequest', () => {
  beforeEach(() => {
    const key = constants().NOTION_API_KEY_PATH;
    fs.mkdirSync(path.dirname(key), { recursive: true });
    fs.writeFileSync(key, 'ntn_secret\n');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the key, version and JSON body and parses the reply', async () => {
    const fake = fakeFetch(() => ({ body: { id: 'p1' } }));
    vi.stubGlobal('fetch', fake.fetch);
    await expect(notionRequest('POST', '/v1/pages', { a: 1 })).resolves.toEqual(
      { id: 'p1' },
    );
    const [call] = fake.calls;
    expect(call?.url.href).toBe('https://api.notion.com/v1/pages');
    expect(call?.headers.Authorization).toBe('Bearer ntn_secret');
    expect(call?.headers['Notion-Version']).toBe(constants().NOTION_VERSION);
    expect(call?.body).toEqual({ a: 1 });
  });

  it("returns raw text and empty bodies as such, and throws Notion's message", async () => {
    const replies = [
      { body: 'plain' },
      { body: '' },
      { status: 404, body: { message: 'Could not find page' } },
      { status: 500, body: 'oops' },
    ];
    vi.stubGlobal('fetch', fakeFetch(() => replies.shift() ?? {}).fetch);
    await expect(notionRequest('GET', '/v1/x')).resolves.toEqual({
      raw: 'plain',
    });
    await expect(notionRequest('GET', '/v1/x')).resolves.toBeNull();
    await expect(notionRequest('GET', '/v1/pages/9')).rejects.toThrow(
      'Notion GET /v1/pages/9 failed (404): Could not find page',
    );
    await expect(notionRequest('GET', '/v1/y')).rejects.toThrow(
      'failed (500): oops',
    );
  });
});

describe('extractFromPublicPage', () => {
  /** A browser that answers evaluate calls by what the script reads. */
  const browser = (
    over: { open?: () => unknown; missingTab?: string; failOnce?: string } = {},
  ): BrowserDeps & { actions: string[] } => {
    const actions: string[] = [];
    let failed = false;
    let active = '';
    return {
      actions,
      sleep: () => Promise.resolve(),
      invoke: (_tool, args) => {
        const action = String(args.action);
        actions.push(action);
        if (action === 'open')
          return Promise.resolve(
            over.open ? over.open() : { details: { targetId: 'T1' } },
          );
        if (action !== 'act') return Promise.resolve({ result: {} });
        const fn = (args.request as { fn: string }).fn;
        if (fn.includes("querySelectorAll('h2')"))
          return Promise.resolve({ result: 'Weekly Sync' });
        if (fn.includes('[role="tab"]')) {
          const tab = /=== "([A-Za-z]+)"/.exec(fn)?.[1] ?? '';
          if (over.failOnce && !failed) {
            failed = true;
            return Promise.reject(new Error(over.failOnce));
          }
          if (tab === over.missingTab)
            return Promise.resolve({
              result: { ok: false, reason: 'tab not found' },
            });
          active = tab;
          return Promise.resolve({ result: { ok: true } });
        }
        if (fn.includes('cutMarkers'))
          return Promise.resolve({ result: `${active} text` });
        return Promise.resolve({ result: 'everything' });
      },
    };
  };

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads the title, each tab and the full text, then closes the tab', async () => {
    const b = browser({ missingTab: 'Notes' });
    await expect(
      extractFromPublicPage('https://notion.site/x', b),
    ).resolves.toEqual({
      h2: 'Weekly Sync',
      fullText: 'everything',
      tabs: {
        summary: 'Summary text',
        notes: '',
        transcript: 'Transcript text',
      },
    });
    expect(b.actions[0]).toBe('start');
    expect(b.actions.at(-1)).toBe('close');
  });

  it('retries a closed target and gives up on other errors', async () => {
    const retried = browser({ failOnce: 'Target closed' });
    await expect(extractFromPublicPage('u', retried)).resolves.toMatchObject({
      h2: 'Weekly Sync',
    });
    expect(retried.actions.filter((a) => a === 'open')).toHaveLength(2);
    await expect(
      extractFromPublicPage('u', browser({ failOnce: 'boom' })),
    ).rejects.toThrow('boom');
    await expect(
      extractFromPublicPage('u', browser({ open: () => ({}) })),
    ).rejects.toThrow('Browser open did not return targetId');
  });
});
