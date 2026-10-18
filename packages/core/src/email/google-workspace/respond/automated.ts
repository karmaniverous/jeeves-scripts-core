/**
 * @module respond/automated
 *
 * Detects automated / bulk mail that must never trigger an auto-reply
 * (mailing lists, bounce/vacation responders, bulk senders). Pure, no
 * dependencies.
 */

/** Headers this check reads (any absent value is treated as ''). */
export interface AutomatedHeaders {
  autoSubmitted?: string;
  listId?: string;
  precedence?: string;
}

/** `Precedence` values treated as bulk/automated mail. */
const BULK_PRECEDENCE = new Set(['bulk', 'list', 'junk']);

/** Result of {@link checkNotAutomated}. */
export interface AutomatedCheckResult {
  automated: boolean;
  /** Present when automated. */
  reason?: string;
}

/**
 * Check whether a message looks automated:
 *
 * - `Auto-Submitted` present and not `no`;
 * - `List-Id` present (mailing-list mail);
 * - `Precedence` is `bulk`, `list` or `junk`.
 */
export function checkNotAutomated(
  headers: AutomatedHeaders,
): AutomatedCheckResult {
  const autoSubmitted = headers.autoSubmitted?.trim();
  if (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') {
    return { automated: true, reason: `Auto-Submitted: ${autoSubmitted}` };
  }
  const listId = headers.listId?.trim();
  if (listId) {
    return { automated: true, reason: `List-Id present: ${listId}` };
  }
  const precedence = headers.precedence?.trim();
  if (precedence && BULK_PRECEDENCE.has(precedence.toLowerCase())) {
    return { automated: true, reason: `Precedence: ${precedence}` };
  }
  return { automated: false };
}
