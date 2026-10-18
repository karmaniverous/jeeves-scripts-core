/**
 * @module respond/recipients
 *
 * Two-step reply-recipient logic for email-respond:
 *
 * 1. {@link addressingOf} classifies the To header: `'sole'` when the
 *    mailbox is the only To addressee (a reply is required), `'shared'`
 *    when there is more than one To addressee (the worker decides
 *    whether a reply is warranted — see respond/task.ts). Qualification
 *    (qualify.ts) has already ruled out Cc-only and BCC-only messages;
 *    this only distinguishes sole vs. shared within "mailbox is in To".
 * 2. {@link buildReplyRecipients} computes the reply's To/Cc/Bcc,
 *    preserving every original addressee (so the reply goes back to the
 *    whole conversation, not just the sender) with the mailbox removed
 *    and addresses deduped case-insensitively across all three lists.
 *
 * Pure, no dependencies beyond address-list parsing.
 */

import { parseAddressList } from './address.js';
import type { CandidateHeaders } from './qualify.js';

/** Whether the mailbox is the sole To addressee, or shares To with others. */
export type Addressing = 'sole' | 'shared';

/**
 * Classify the To header for one message. `'sole'` when the deduped
 * (case-insensitive) To list is exactly `[mailbox]`; `'shared'`
 * otherwise.
 */
export function addressingOf(
  headers: Pick<CandidateHeaders, 'to'>,
  mailbox: string,
): Addressing {
  const mb = mailbox.toLowerCase();
  const to = [...new Set(parseAddressList(headers.to))];
  return to.length === 1 && to[0] === mb ? 'sole' : 'shared';
}

/** The reply's recipient lists. */
export interface ReplyRecipients {
  to: string[];
  cc: string[];
  bcc: string[];
}

/**
 * Build the reply's recipient lists from the original message: To =
 * `[sender, ...original To]`, Cc = original Cc, Bcc = original Bcc, with
 * the mailbox removed from every list and every address deduped
 * case-insensitively across all three lists (first occurrence wins,
 * checked in order To, Cc, Bcc), preserving relative order.
 */
export function buildReplyRecipients(
  headers: Pick<CandidateHeaders, 'to' | 'cc' | 'bcc'>,
  senderEmail: string,
  mailbox: string,
): ReplyRecipients {
  const mb = mailbox.toLowerCase();
  const seen = new Set<string>();
  const dedupe = (addrs: readonly string[]): string[] => {
    const kept: string[] = [];
    for (const addr of addrs) {
      const lower = addr.toLowerCase();
      if (lower === mb) continue;
      if (seen.has(lower)) continue;
      seen.add(lower);
      kept.push(addr);
    }
    return kept;
  };

  return {
    to: dedupe([senderEmail, ...parseAddressList(headers.to)]),
    cc: dedupe(parseAddressList(headers.cc)),
    bcc: dedupe(parseAddressList(headers.bcc)),
  };
}
