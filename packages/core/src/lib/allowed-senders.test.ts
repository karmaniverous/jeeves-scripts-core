import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { allowedSenderSchema, isAllowedSender } from './allowed-senders.js';

describe('allowedSenderSchema', () => {
  it.each([
    ['jane@example.com', 'jane@example.com'],
    ['  Jane@EXAMPLE.com ', 'jane@example.com'],
    ['*@example.com', '*@example.com'],
    ['*@Example.CO.uk', '*@example.co.uk'],
    ['*@*.example.com', '*@*.example.com'],
    ['*@*.mail.my-corp.example', '*@*.mail.my-corp.example'],
  ])('accepts %j as %j', (input, output) => {
    expect(allowedSenderSchema.parse(input)).toBe(output);
  });

  it.each([
    '*',
    '*@*',
    '*@',
    '*@*.',
    '*@.example.com',
    '*@example',
    '*@*.example',
    '*@*.*.example.com',
    '*@ex*ample.com',
    '*@example.*',
    'j*@example.com',
    '*jane@example.com',
    '*.example.com',
    '@example.com',
    '**@example.com',
    '*@*example.com',
    '*@-example.com',
    'not-an-email',
    'jane@example',
    'jane@example.com x',
    '*@example.com!',
  ])('rejects %j', (input) => {
    expect(allowedSenderSchema.safeParse(input).success).toBe(false);
  });

  it('carries a JSON Schema pattern that accepts entries in either case', () => {
    const { pattern } = z
      .object({ pattern: z.string() })
      .parse(z.toJSONSchema(allowedSenderSchema, { target: 'draft-7' }));
    const re = new RegExp(pattern);
    for (const entry of [
      'Jane@Example.com',
      '*@Example.COM',
      '*@*.Sub.Example.com',
    ])
      expect(re.test(entry)).toBe(true);
    for (const entry of ['*', '*@*', '*@*.*.example.com'])
      expect(re.test(entry)).toBe(false);
  });
});

describe('isAllowedSender', () => {
  it('matches an exact address, case-insensitively', () => {
    expect(isAllowedSender('jane@example.com', ['jane@example.com'])).toBe(
      true,
    );
    expect(isAllowedSender('Jane@Example.COM', ['jane@example.com'])).toBe(
      true,
    );
    expect(isAllowedSender('jane@example.com', ['JANE@example.com'])).toBe(
      true,
    );
    expect(isAllowedSender('john@example.com', ['jane@example.com'])).toBe(
      false,
    );
    expect(isAllowedSender(' jane@example.com ', ['jane@example.com'])).toBe(
      true,
    );
  });

  it('an exact entry matches only the whole address', () => {
    const entries = ['jane@example.com'];
    expect(isAllowedSender('xjane@example.com', entries)).toBe(false);
    expect(isAllowedSender('jane@example.com.evil.test', entries)).toBe(false);
    expect(isAllowedSender('jane@sub.example.com', entries)).toBe(false);
  });

  it('*@domain matches exactly that domain, not a subdomain', () => {
    const entries = ['*@example.com'];
    expect(isAllowedSender('anyone@example.com', entries)).toBe(true);
    expect(isAllowedSender('ANYONE@EXAMPLE.COM', entries)).toBe(true);
    expect(isAllowedSender('a@sub.example.com', entries)).toBe(false);
  });

  it('*@*.domain matches any subdomain, not the bare domain', () => {
    const entries = ['*@*.example.com'];
    expect(isAllowedSender('a@sub.example.com', entries)).toBe(true);
    expect(isAllowedSender('a@deep.sub.example.com', entries)).toBe(true);
    expect(isAllowedSender('a@Sub.Example.Com', entries)).toBe(true);
    expect(isAllowedSender('a@example.com', entries)).toBe(false);
  });

  // Look-alikes of corp.example, kept to reserved names (no-instance-data).
  it.each([
    'a@evil-corp.example',
    'a@notcorp.example',
    'a@sub-corp.example',
    'a@corp.example.evil.test',
    'a@sub.corp.example.invalid',
    'a@corp.example.test',
    'corp.example@evil.test',
  ])('does not match the look-alike %j', (sender) => {
    expect(
      isAllowedSender(sender, ['*@corp.example', '*@*.corp.example']),
    ).toBe(false);
  });

  it('matches the real domain those look-alikes imitate', () => {
    const entries = ['*@corp.example', '*@*.corp.example'];
    expect(isAllowedSender('a@corp.example', entries)).toBe(true);
    expect(isAllowedSender('a@sub.corp.example', entries)).toBe(true);
  });

  it('mixes exact addresses and patterns in one list', () => {
    const entries = ['owner@other.example', '*@example.com'];
    expect(isAllowedSender('owner@other.example', entries)).toBe(true);
    expect(isAllowedSender('x@example.com', entries)).toBe(true);
    expect(isAllowedSender('x@other.example', entries)).toBe(false);
  });

  it('never matches a sender without a local part or domain', () => {
    expect(isAllowedSender('@example.com', ['*@example.com'])).toBe(false);
    expect(isAllowedSender('example.com', ['*@example.com'])).toBe(false);
    expect(isAllowedSender('', ['*@example.com'])).toBe(false);
  });
});
