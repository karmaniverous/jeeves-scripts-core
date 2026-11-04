import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  allowedSenderSchema,
  CONSUMER_MAIL_DOMAINS,
  isAllowedSender,
} from './allowed-senders.js';

const messages = (input: string): string[] =>
  allowedSenderSchema.safeParse(input).error?.issues.map((i) => i.message) ??
  [];

describe('allowedSenderSchema', () => {
  it.each([
    ['jane@example.com', 'jane@example.com'],
    ['  Jane@EXAMPLE.com ', 'jane@example.com'],
    ['jane.doe+ops@mail.my-corp.example', 'jane.doe+ops@mail.my-corp.example'],
    ['*@example.com', '*@example.com'],
    ['*@Example.CO.uk', '*@example.co.uk'],
    ['*@mail.my-corp.example', '*@mail.my-corp.example'],
    ['*@xn--bcher-kva.example', '*@xn--bcher-kva.example'],
    // An exact address at a consumer provider stays allowed (every one).
    ...CONSUMER_MAIL_DOMAINS.map((d) => [`someone@${d}`, `someone@${d}`]),
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
    '*@com',
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
    '*@bücher.example',
    'not-an-email',
    'jane@example',
    'jane@example.com x',
    '*@example.com!',
    'a<b>@x.example',
    '"a"@x.example',
    '"a b"@x.example',
    'a,b@x.example',
    'a(b)@x.example',
    'jane@x..example',
    'jane@-x.example',
  ])('rejects %j', (input) => {
    expect(allowedSenderSchema.safeParse(input).success).toBe(false);
  });

  it.each(['*@*.example.com', '*@*.mail.my-corp.example', '*@*.co.uk'])(
    'rejects the subdomain pattern %j, saying they are not supported',
    (input) => {
      expect(messages(input)).toContain(
        'subdomain patterns (*@*.<domain>) are not supported; list *@<domain> for each domain',
      );
    },
  );

  it('names the supported forms when an entry is malformed', () => {
    expect(messages('j*@example.com')).toEqual([
      'must be an email address or *@<domain> (an ASCII domain of two or more labels); no other wildcard is supported',
    ]);
  });

  it.each(CONSUMER_MAIL_DOMAINS.map((d) => [d]))(
    'rejects *@%s (a consumer provider), not an exact address there',
    (domain) => {
      expect(messages(`*@${domain}`)).toEqual([
        `*@${domain} would admit anyone with a ${domain} account; list exact addresses instead`,
      ]);
      expect(messages(`*@${domain.toUpperCase()}`)).toHaveLength(1);
      expect(allowedSenderSchema.parse(`jane@${domain}`)).toBe(
        `jane@${domain}`,
      );
    },
  );

  it('denies at least the consumer providers the owner named', () => {
    for (const d of [
      'gmail.com',
      'googlemail.com',
      'outlook.com',
      'hotmail.com',
      'live.com',
      'msn.com',
      'yahoo.com',
      'ymail.com',
      'icloud.com',
      'me.com',
      'mac.com',
      'aol.com',
      'proton.me',
      'protonmail.com',
      'pm.me',
      'gmx.com',
      'gmx.net',
      'mail.com',
      'yandex.com',
      'yandex.ru',
      'zoho.com',
      'fastmail.com',
      'hey.com',
      'qq.com',
      '163.com',
      '126.com',
    ])
      expect(CONSUMER_MAIL_DOMAINS).toContain(d);
  });

  it('carries a JSON Schema pattern that accepts entries in either case', () => {
    const { pattern } = z
      .object({ pattern: z.string() })
      .parse(z.toJSONSchema(allowedSenderSchema, { target: 'draft-7' }));
    const re = new RegExp(pattern);
    for (const entry of ['Jane@Example.com', '*@Example.COM'])
      expect(re.test(entry)).toBe(true);
    for (const entry of ['*', '*@*', '*@*.Sub.Example.com', 'a<b>@x.example'])
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
    expect(isAllowedSender('a@deep.sub.example.com', entries)).toBe(false);
  });

  it('a subdomain-pattern entry (rejected by the schema) matches nothing', () => {
    const entries = ['*@*.example.com'];
    expect(isAllowedSender('a@sub.example.com', entries)).toBe(false);
    expect(isAllowedSender('a@example.com', entries)).toBe(false);
  });

  // Look-alikes of corp.example, kept to reserved names (no-instance-data).
  it.each([
    'a@evil-corp.example',
    'a@notcorp.example',
    'a@sub-corp.example',
    'a@corp.example.evil.test',
    'a@sub.corp.example',
    'a@sub.corp.example.invalid',
    'a@corp.example.test',
    'corp.example@evil.test',
  ])('does not match the look-alike %j', (sender) => {
    expect(isAllowedSender(sender, ['*@corp.example'])).toBe(false);
  });

  it('matches the real domain those look-alikes imitate', () => {
    expect(isAllowedSender('a@corp.example', ['*@corp.example'])).toBe(true);
  });

  // A malformed sender domain never matches, whatever the entry.
  it.each([
    'a@.corp.example',
    'a@corp..example',
    'a@corp.example.',
    'a@*.corp.example',
    'a@%.corp.example',
    'a@-x.corp.example',
    'a@corp',
    'a@',
  ])('never matches the malformed sender %j', (sender) => {
    const domain = sender.slice(sender.indexOf('@') + 1);
    expect(isAllowedSender(sender, [`*@${domain}`, sender])).toBe(false);
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
