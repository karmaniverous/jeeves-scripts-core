/**
 * @module lib/allowed-senders
 *
 * The `emailConfig.respond.allowedSenders` grammar and matcher (#53). An
 * entry is an exact address, `*@example.com` (any address at exactly that
 * domain) or `*@*.example.com` (any address at a subdomain, not the bare
 * domain). Any other `*` is rejected. Matching is case-insensitive. Pure:
 * used by the config schema and email-respond's qualification, which
 * still excludes the mailbox and still requires DKIM.
 */

import { z } from 'zod';

/**
 * One DNS label: letters, digits and inner hyphens (either case, so the
 * JSON Schema, which can't lowercase first, accepts what Zod accepts).
 */
const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?';
/** A domain of at least two labels. */
const DOMAIN = `(?:${LABEL}\\.)+${LABEL}`;

const EXACT = '[^\\s@*]+@[^\\s@*]+\\.[^\\s@*]+';
const DOMAIN_PATTERN = new RegExp(`^\\*@(${DOMAIN})$`);
const SUBDOMAIN_PATTERN = new RegExp(`^\\*@\\*\\.(${DOMAIN})$`);
/** Any valid entry (one regex, so the JSON Schema carries it too). */
const ENTRY = new RegExp(`^(?:${EXACT}|\\*@${DOMAIN}|\\*@\\*\\.${DOMAIN})$`);

/**
 * One `allowedSenders` entry: trimmed, lowercased, and an exact address,
 * `*@<domain>` or `*@*.<domain>`.
 */
export const allowedSenderSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(ENTRY, 'must be an email address, *@<domain> or *@*.<domain>');

/** The domain of an address: everything after its last `@`. */
const domainOf = (address: string): string =>
  address.slice(address.lastIndexOf('@') + 1);

/** Whether one entry matches `sender` (both compared lowercased). */
const matches = (sender: string, entry: string): boolean => {
  const e = entry.toLowerCase();
  const domain = SUBDOMAIN_PATTERN.exec(e)?.[1];
  if (domain !== undefined) return domainOf(sender).endsWith(`.${domain}`);
  const exactDomain = DOMAIN_PATTERN.exec(e)?.[1];
  if (exactDomain !== undefined) return domainOf(sender) === exactDomain;
  return sender === e;
};

/**
 * Whether `sender` is covered by any `allowedSenders` entry. It does not
 * exclude the mailbox: the caller does, before asking.
 */
export const isAllowedSender = (
  sender: string,
  entries: readonly string[],
): boolean => {
  const s = sender.trim().toLowerCase();
  if (!s.includes('@') || s.startsWith('@')) return false;
  return entries.some((entry) => matches(s, entry));
};
