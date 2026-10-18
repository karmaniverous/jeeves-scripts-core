/**
 * @module respond/qualify
 *
 * Pure qualification of one candidate message for email-respond: every
 * condition must hold, or the message is skipped with a logged reason.
 * No network, no state — the runner-state checks (already handled,
 * thread under the hourly cap) are orchestration-level, in
 * email/respond/orchestrate.ts.
 *
 * Conditions (all must hold):
 * 1. The From address is in `allowedSenders` and is not the mailbox.
 * 2. The mailbox is in To (Cc-only or absent from both is a skip).
 * 3. DKIM authenticates the sender (dkim.ts).
 * 4. The message does not look automated/bulk (automated.ts).
 */

import {
  parseAddressList,
  type ParsedAddress,
  parseFirstAddress,
} from './address.js';
import { checkNotAutomated } from './automated.js';
import { checkDkim } from './dkim.js';

/** Headers qualification needs from a candidate message. */
export interface CandidateHeaders {
  from: string;
  to: string;
  cc: string;
  /** Rarely present on received mail; preserved on replies when it is. */
  bcc: string;
  /** Every `Authentication-Results` header value on the message. */
  authenticationResults: readonly string[];
  autoSubmitted: string;
  listId: string;
  precedence: string;
}

/** The message qualifies: handle it as a request from this sender. */
export interface QualifyOk {
  qualifies: true;
  sender: ParsedAddress;
}

/** The message does not qualify, and why. */
export interface QualifyFail {
  qualifies: false;
  reason: string;
}

export type QualifyResult = QualifyOk | QualifyFail;

/** Inputs independent of any one message. */
export interface QualifyOptions {
  /** The mailbox being checked (lowercased). */
  mailbox: string;
  /** Allowed senders (lowercased). */
  allowedSenders: readonly string[];
}

/**
 * Qualify one candidate message. Pure: same inputs, same result.
 */
export function qualifyMessage(
  headers: CandidateHeaders,
  opts: QualifyOptions,
): QualifyResult {
  // A multi-address From could put an allowed sender first; require one.
  if (parseAddressList(headers.from).length !== 1) {
    return {
      qualifies: false,
      reason: 'From must contain exactly one address',
    };
  }
  const sender = parseFirstAddress(headers.from);
  if (!sender) {
    return { qualifies: false, reason: 'unparseable From header' };
  }
  if (sender.email === opts.mailbox) {
    return { qualifies: false, reason: 'message sent by the mailbox itself' };
  }
  if (!opts.allowedSenders.includes(sender.email)) {
    return {
      qualifies: false,
      reason: `sender ${sender.email} is not in allowedSenders`,
    };
  }

  const toAddrs = parseAddressList(headers.to);
  if (!toAddrs.includes(opts.mailbox)) {
    const ccAddrs = parseAddressList(headers.cc);
    if (ccAddrs.includes(opts.mailbox)) {
      return { qualifies: false, reason: 'mailbox is only on Cc, not To' };
    }
    return {
      qualifies: false,
      reason: 'mailbox is not in To or Cc (likely BCC)',
    };
  }

  const senderDomain = sender.email.split('@')[1] ?? '';
  const dkim = checkDkim(headers.authenticationResults, senderDomain);
  if (!dkim.ok) {
    return {
      qualifies: false,
      reason: `DKIM check failed: ${dkim.reason ?? 'unknown'}`,
    };
  }

  const automated = checkNotAutomated({
    autoSubmitted: headers.autoSubmitted,
    listId: headers.listId,
    precedence: headers.precedence,
  });
  if (automated.automated) {
    return {
      qualifies: false,
      reason: `looks automated: ${automated.reason ?? 'unknown'}`,
    };
  }

  return { qualifies: true, sender };
}
