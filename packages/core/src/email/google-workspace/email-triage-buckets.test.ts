/**
 * Tests for the config-dependent triage rules (bucket routing, deep-fetch
 * importance) over a temp config with buckets, plus the receipt, junk and
 * reply heuristics.
 */

import { describe, expect, it } from 'vitest';

import { useTempConfig } from '../../lib/temp-config.test-helper.js';
import {
  classifyBucket,
  isJunkCandidate,
  isReceiptCandidate,
  looksImportantBySummary,
  pendingKey,
  shouldExpectResponse,
} from './email-triage.js';

useTempConfig((base) => ({
  pipeline: {
    ...(base.pipeline as object),
    buckets: {
      domains: [
        { pattern: 'acme.com', bucket: 'acme' },
        { pattern: 'partner.io', bucket: 'partners' },
        { pattern: 'vendor.net', bucket: 'vendors' },
      ],
      priority: ['acme', 'partners'],
    },
  },
}));

describe('classifyBucket', () => {
  it('routes by the account domain first', () => {
    expect(classifyBucket('me@acme.com', 'x@partner.io', '', '', '')).toBe(
      'acme',
    );
  });

  it('then by the highest-priority TO domain', () => {
    expect(
      classifyBucket('me@home.org', 'a@vendor.net, b@partner.io', '', '', ''),
    ).toBe('partners');
  });

  it('never routes by a TO domain whose bucket has no priority', () => {
    expect(
      classifyBucket('me@home.org', 'a@vendor.net', '', '', ''),
    ).toBeNull();
  });

  it('then by the content, else no bucket', () => {
    expect(
      classifyBucket(
        'me@home.org',
        'a@else.org',
        'News from vendor.net',
        '',
        '',
      ),
    ).toBe('vendors');
    expect(classifyBucket('me@home.org', '', 'hello', '', '')).toBeNull();
  });
});

describe('looksImportantBySummary', () => {
  it.each([
    [{ labels: ['UNREAD'], receiptCandidate: false, bucket: null }, true],
    [{ labels: [], receiptCandidate: true, bucket: null }, true],
    [{ labels: [], receiptCandidate: false, bucket: 'acme' }, true],
    [{ labels: [], receiptCandidate: false, bucket: 'vendors' }, false],
    [{ labels: ['SENT'], receiptCandidate: false, bucket: null }, false],
  ])('%j -> %s', (params, expected) => {
    expect(looksImportantBySummary(params)).toBe(expected);
  });
});

describe('heuristics', () => {
  it('never treats mail from the account as a receipt', () => {
    expect(
      isReceiptCandidate('Your invoice', '', 'me@acme.com', 'me@acme.com'),
    ).toBe(false);
    expect(
      isReceiptCandidate('Your invoice', '', 'billing@shop.com', 'me@acme.com'),
    ).toBe(true);
    expect(isJunkCandidate('Big sale', '', 'shop')).toBe(true);
  });

  it.each([
    [{ from: 'noreply@x.com', to: '' }, false],
    [{ from: 'a@x.com', to: 'donotreply@y.com' }, false],
    [{ from: 'voice-noreply@google.com', to: '' }, false],
    [
      { from: 'a@x.com', to: 'b@y.com', subject: 'New voicemail from Jane' },
      false,
    ],
    [{ from: 'a@x.com', to: 'b@y.com', receiptCandidate: true }, false],
    [{ from: 'a@x.com', to: 'b@y.com' }, true],
  ])('shouldExpectResponse %j -> %s', (over, expected) => {
    expect(
      shouldExpectResponse({
        subject: 'Hi',
        receiptCandidate: false,
        junkCandidate: false,
        ...over,
      }),
    ).toBe(expected);
  });

  it('keys pending follow-ups by account and thread', () => {
    expect(pendingKey('me@acme.com', 't1')).toBe('me@acme.com::t1');
  });
});
