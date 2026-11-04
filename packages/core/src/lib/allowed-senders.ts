/**
 * @module lib/allowed-senders
 *
 * The `emailConfig.respond.allowedSenders` grammar and matcher (#53). An
 * entry is an exact address or `*@example.com` (any address at exactly
 * that domain). Nothing else: subdomain patterns (`*@*.example.com`) and
 * every other `*` fail config validation, and so does `*@<domain>` for a
 * single-label domain or a {@link CONSUMER_MAIL_DOMAINS} provider (an
 * exact address there is fine). Domains are ASCII (an IDN is written in
 * punycode, `xn--`). Matching is case-insensitive. Pure: used by the
 * config schema and email-respond's qualification, which still excludes
 * the mailbox and still requires DKIM.
 */

import { z } from 'zod';

/**
 * One DNS label: letters, digits and inner hyphens (either case, so the
 * JSON Schema, which can't lowercase first, accepts what Zod accepts).
 */
const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?';
/** A domain of at least two labels. */
const DOMAIN = `(?:${LABEL}\\.)+${LABEL}`;
/**
 * A plain addr-spec local part: no space, `@`, `*`, quote, angle bracket,
 * comma or other RFC 5322 special, so an entry is never one the address
 * parser (respond/address.ts) can't yield.
 */
const LOCAL = '[^\\s@*"<>,;:()\\[\\]\\\\]+';

/** Any valid entry shape (one regex, so the JSON Schema carries it too). */
const ENTRY = new RegExp(`^(?:${LOCAL}|\\*)@${DOMAIN}$`);
const DOMAIN_PATTERN = /^\*@(.+)$/;
const SENDER_DOMAIN = new RegExp(`^${DOMAIN}$`, 'i');

/**
 * Consumer mail providers anyone can sign up at: `*@<one of these>` would
 * let any stranger with an account there make the assistant act, so the
 * config rejects it (an exact address at one of them is still allowed).
 */
export const CONSUMER_MAIL_DOMAINS: readonly string[] = [
  '126.com',
  '163.com',
  'aol.com',
  'fastmail.com',
  'gmail.com',
  'gmx.com',
  'gmx.net',
  'googlemail.com',
  'hey.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mac.com',
  'mail.com',
  'me.com',
  'msn.com',
  'outlook.com',
  'pm.me',
  'proton.me',
  'protonmail.com',
  'qq.com',
  'yahoo.com',
  'yandex.com',
  'yandex.ru',
  'ymail.com',
  'zoho.com',
];

/**
 * The reason beyond the shape check an entry (trimmed, lowercased) is
 * rejected: a subdomain pattern, or a consumer provider's `*@<domain>`.
 */
const entryProblem = (entry: string): string | undefined => {
  if (entry.startsWith('*@*.'))
    return 'subdomain patterns (*@*.<domain>) are not supported; list *@<domain> for each domain';
  const domain = DOMAIN_PATTERN.exec(entry)?.[1];
  if (domain !== undefined && CONSUMER_MAIL_DOMAINS.includes(domain))
    return `*@${domain} would admit anyone with a ${domain} account; list exact addresses instead`;
  return undefined;
};

/**
 * One `allowedSenders` entry: trimmed, lowercased, and an exact address
 * or `*@<domain>` (not a consumer provider).
 */
export const allowedSenderSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    ENTRY,
    'must be an email address or *@<domain> (an ASCII domain of two or more labels); no other wildcard is supported',
  )
  .superRefine((entry, ctx) => {
    const problem = entryProblem(entry);
    if (problem !== undefined)
      ctx.addIssue({ code: 'custom', message: problem });
  });

/** Whether one entry matches `sender` (lowercased, domain validated). */
const matches = (sender: string, domain: string, entry: string): boolean => {
  const e = entry.toLowerCase();
  const patternDomain = DOMAIN_PATTERN.exec(e)?.[1];
  if (patternDomain !== undefined) return domain === patternDomain;
  return sender === e;
};

/**
 * Whether `sender` is covered by any `allowedSenders` entry. A sender
 * without a local part, or whose domain is not a well-formed ASCII domain
 * of two or more labels, never matches. It does not exclude the mailbox:
 * the caller does, before asking.
 */
export const isAllowedSender = (
  sender: string,
  entries: readonly string[],
): boolean => {
  const s = sender.trim().toLowerCase();
  const at = s.lastIndexOf('@');
  const domain = s.slice(at + 1);
  if (at < 1 || !SENDER_DOMAIN.test(domain)) return false;
  return entries.some((entry) => matches(s, domain, entry));
};
