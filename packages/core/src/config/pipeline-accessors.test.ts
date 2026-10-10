import fs from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetConfig } from './loader.js';
import {
  getBucketForDomain,
  getBucketNames,
  getBucketPriority,
  getCalendarAccounts,
  getEmailAccounts,
  getGmailAccounts,
  getRef,
  pipeline,
  tryGetRef,
} from './pipeline-accessors.js';

const VALID_CONFIG = {
  instance: { name: 'test', baseDir: 'J:/' },
  pipeline: {
    accounts: [
      {
        email: 'alice@example.com',
        type: 'gmail',
        calendar: { tokenFile: 'token-alice.json' },
        emailPolling: true,
      },
      {
        email: 'bob@example.com',
        type: 'gmail',
        calendar: { serviceAccount: 'auto' },
        emailPolling: false,
      },
      {
        email: 'carol@example.com',
        type: 'imap',
        emailPolling: true,
        imap: {
          host: 'imap.example.com',
          port: 993,
          tls: true,
          user: 'carol@example.com',
          password: { secretRef: 'carol' },
        },
        folders: ['INBOX', 'Sent'],
      },
    ],
    buckets: {
      domains: [
        { pattern: 'example.com', bucket: 'Example' },
        { pattern: 'other.org', bucket: 'Other' },
      ],
      priority: ['Example', 'Other'],
    },
    refs: {
      'notion.inboxId': 'abc-123',
      'paths.bin': '/usr/local/bin/tool',
    },
    emailConfig: {
      reportOnly: false,
      digest: { slackChannelId: 'C1234' },
    },
  },
};

describe('pipeline-accessors', () => {
  beforeEach(() => {
    resetConfig();
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(VALID_CONFIG));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetConfig();
  });

  const options = { root: '/root' };

  it('loads and validates the pipeline block', () => {
    const config = pipeline(options);
    expect(config.accounts).toHaveLength(3);
  });

  it('throws a clear error when no pipeline block is configured', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ instance: { name: 'test', baseDir: 'J:/' } }),
    );
    resetConfig();
    expect(() => pipeline(options)).toThrow(/no "pipeline" block/);
  });

  it('getCalendarAccounts returns only accounts with calendar config', () => {
    const accounts = getCalendarAccounts(options);
    expect(accounts.map((a) => a.email)).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);
  });

  it('getEmailAccounts returns emails with emailPolling enabled', () => {
    expect(getEmailAccounts(options)).toEqual([
      'alice@example.com',
      'carol@example.com',
    ]);
  });

  it('getGmailAccounts returns polled accounts without an imap block', () => {
    expect(getGmailAccounts(options)).toEqual(['alice@example.com']);
  });

  it('getBucketNames lists priority then domain-only, deduplicated', () => {
    expect(getBucketNames(options)).toEqual(['Example', 'Other']);
  });

  it('getBucketForDomain is case-insensitive and null for unknown', () => {
    expect(getBucketForDomain('EXAMPLE.COM', options)).toBe('Example');
    expect(getBucketForDomain('unknown.net', options)).toBeNull();
  });

  it('getBucketPriority returns the priority index map', () => {
    expect(getBucketPriority(options)).toEqual({ Example: 0, Other: 1 });
  });

  it('getRef returns a known ref and throws for a missing one', () => {
    expect(getRef('notion.inboxId', options)).toBe('abc-123');
    expect(() => getRef('missing.key', options)).toThrow(
      'Missing pipeline config ref: missing.key',
    );
  });

  it('tryGetRef returns empty string for a missing key', () => {
    expect(tryGetRef('missing.key', options)).toBe('');
  });
});
