import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CONFIG_PATH_ENV, resetConfig } from '../config/loader.js';
import {
  type CacheMessage,
  createOrUpdateCache,
  detectLabelChanges,
  getThreadsPath,
  loadCache,
} from './email-cache.js';

let dir: string;
let savedEnv: string | undefined;

const message = (over: Partial<CacheMessage> = {}): CacheMessage => ({
  messageId: 'm1',
  from: 'a@acme.com',
  to: 'me@example.com',
  cc: '',
  date: null,
  internalDateMs: null,
  labels: ['INBOX'],
  snippet: 'hi',
  hasAttachments: false,
  attachments: [],
  ...over,
});

beforeEach(() => {
  savedEnv = process.env[CONFIG_PATH_ENV];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-cache-'));
  const configPath = path.join(dir, 'jeeves-scripts.json');
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      instance: { name: 't', baseDir: dir },
      siloRouting: {
        silos: {
          acme: {
            basePath: path.join(dir, 'acme'),
            emailDomains: ['acme.com'],
          },
        },
      },
    }),
  );
  process.env[CONFIG_PATH_ENV] = configPath;
  resetConfig();
});

afterEach(() => {
  process.env[CONFIG_PATH_ENV] = savedEnv;
  resetConfig();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('getThreadsPath', () => {
  it("routes by the account's email domain, else the default silo", () => {
    expect(getThreadsPath('me@acme.com', 't1')).toBe(
      path.join(dir, 'acme', 'email', 'threads', 'me@acme.com', 't1'),
    );
    expect(getThreadsPath('me@example.com', 't1')).toBe(
      path.join(dir, 'content', 'email', 'threads', 'me@example.com', 't1'),
    );
  });
});

describe('createOrUpdateCache', () => {
  const base = {
    account: 'me@example.com',
    threadId: 't1',
    subject: 'Hello',
    participants: ['a@acme.com'],
  };

  it('creates thread.json on first write and reads it back', () => {
    expect(loadCache('me@example.com', 't1')).toBeNull();
    const created = createOrUpdateCache({
      ...base,
      messages: { m1: message() },
      provenance: [],
    });
    expect(loadCache('me@example.com', 't1')).toEqual(created);
    expect(created.messages?.m1?.labels).toEqual(['INBOX']);
  });

  it('merges messages, appends provenance and keeps cachedAt', () => {
    const first = createOrUpdateCache({
      ...base,
      messages: { m1: message() },
      provenance: [],
    });
    const prov = {
      field: 'labels',
      messageId: 'm1',
      value: '+Work',
      by: 'human',
      at: '2026-01-01T00:00:00Z',
    };
    const second = createOrUpdateCache({
      ...base,
      subject: 'Re: Hello',
      messages: {
        m1: message({ labels: ['INBOX', 'Work'] }),
        m2: message({ messageId: 'm2' }),
      },
      provenance: [prov],
    });
    expect(second.cachedAt).toBe(first.cachedAt);
    expect(second.subject).toBe('Re: Hello');
    expect(Object.keys(second.messages ?? {})).toEqual(['m1', 'm2']);
    expect(second.messages?.m1?.labels).toEqual(['INBOX', 'Work']);
    expect(second.provenance).toEqual([prov]);
  });
});

describe('detectLabelChanges', () => {
  it('reports added and removed labels as human provenance', () => {
    const changes = detectLabelChanges(
      ['INBOX', 'Old'],
      ['INBOX', 'New'],
      'm1',
    );
    expect(changes.map((c) => c.value)).toEqual(['+New', '-Old']);
    expect(changes.every((c) => c.by === 'human' && c.messageId === 'm1')).toBe(
      true,
    );
  });

  it('treats missing label lists as empty', () => {
    expect(detectLabelChanges(undefined, undefined, 'm1')).toEqual([]);
    expect(
      detectLabelChanges(undefined, ['A'], 'm1').map((c) => c.value),
    ).toEqual(['+A']);
  });
});
