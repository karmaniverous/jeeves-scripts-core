/**
 * @module account-types
 *
 * Registry of IMAP account type definitions. Maps type names to
 * provider-specific IMAP behavior: extension fetch items, JSONPath expressions
 * for threadId/messageId key resolution, label extraction, and folder
 * enumeration. Extend by adding entries to ACCOUNT_TYPE_REGISTRY.
 *
 * Used by poll.ts to resolve the correct behavior for each configured account.
 * Input: account type name string. Output: AccountTypeDefinition.
 */

import type { ImapFlow } from 'imapflow';

import type { NormalizedMessage } from './normalize.js';

// ── Interface ─────────────────────────────────────────────────────────

export interface AccountTypeDefinition {
  /** IMAP FETCH extension items to request (e.g. 'X-GM-THRID'). */
  extensions: string[];
  /**
   * JSONPath expressions against NormalizedMessage. All paths resolve,
   * values are concatenated, then auto-transformed to a hex key.
   */
  threadId: string[];
  /** Same semantics as threadId, resolves to the per-message key. */
  messageId: string[];
  /** Extract and normalize labels from a fetched NormalizedMessage. */
  labels: (msg: NormalizedMessage) => string[];
  /** Return the ordered list of folders to poll for this account. */
  folders: (conn: ImapFlow) => Promise<string[]>;
}

// ── Gmail label normalization ─────────────────────────────────────────

/**
 * Gmail IMAP X-GM-LABELS uses backslash-prefixed system labels (\Inbox,
 * \Sent, etc.) while the Gmail API uses UPPERCASE (INBOX, SENT, etc.).
 * Normalize IMAP labels to API format so on-disk output matches.
 */
const GMAIL_SYSTEM_LABEL_MAP: Partial<Record<string, string>> = {
  '\\Inbox': 'INBOX',
  '\\Sent': 'SENT',
  '\\Trash': 'TRASH',
  '\\Draft': 'DRAFT',
  '\\Spam': 'SPAM',
  '\\Starred': 'STARRED',
  '\\Important': 'IMPORTANT',
};

function normalizeGmailLabels(labels: string[], flags: string[]): string[] {
  const result: string[] = [];
  for (const label of labels) {
    const mapped = GMAIL_SYSTEM_LABEL_MAP[label];
    result.push(mapped ?? label.toUpperCase());
  }
  if (!flags.includes('\\Seen')) result.push('UNREAD');
  return result;
}

// ── IMAP flag normalization ───────────────────────────────────────────

/** Map standard IMAP system flags to a human-readable label vocabulary. */
function normalizeImapFlags(flags: string[]): string[] {
  const result: string[] = [];
  if (!flags.includes('\\Seen')) result.push('UNREAD');
  for (const flag of flags) {
    switch (flag) {
      case '\\Flagged':
        result.push('STARRED');
        break;
      case '\\Draft':
        result.push('DRAFT');
        break;
      case '\\Deleted':
        result.push('TRASH');
        break;
      case '\\Answered':
        result.push('ANSWERED');
        break;
      case '\\Seen':
      case '\\Recent':
        break;
      default:
        // Custom flags (e.g. $Forwarded) — strip leading $, uppercase
        if (!flag.startsWith('\\')) {
          result.push(flag.replace(/^\$/, '').toUpperCase());
        }
        break;
    }
  }
  return result;
}

// ── Type definitions ──────────────────────────────────────────────────

const gmail: AccountTypeDefinition = {
  extensions: ['X-GM-THRID', 'X-GM-MSGID', 'X-GM-LABELS'],
  threadId: ['$.extensions.x-gm-thrid'],
  messageId: ['$.extensions.x-gm-msgid'],
  labels: (msg) => {
    const raw = msg.extensions['x-gm-labels'];
    const imapLabels = Array.isArray(raw) ? raw : [];
    return normalizeGmailLabels(imapLabels, msg.flags);
  },
  folders: () =>
    Promise.resolve(['[Gmail]/All Mail', '[Gmail]/Spam', '[Gmail]/Trash']),
};

const genericImap: AccountTypeDefinition = {
  extensions: [],
  threadId: ['$.computed.threadRoot'],
  messageId: ['$.headers.message-id'],
  labels: (msg) => normalizeImapFlags(msg.flags),
  folders: async (conn) => {
    const list = await conn.list();
    return list.map((f) => f.path);
  },
};

// ── Registry ──────────────────────────────────────────────────────────

export const ACCOUNT_TYPE_REGISTRY: Partial<
  Record<string, AccountTypeDefinition>
> = {
  gmail,
  imap: genericImap,
};

/** Look up an account type by name, throwing if unknown. */
export function getAccountType(typeName: string): AccountTypeDefinition {
  const def = ACCOUNT_TYPE_REGISTRY[typeName];
  if (!def) throw new Error(`Unknown IMAP account type: "${typeName}"`);
  return def;
}
