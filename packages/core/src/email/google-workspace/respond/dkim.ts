/**
 * @module respond/dkim
 *
 * Sender authentication from Gmail's `Authentication-Results` header.
 * Pure parsing; no dependencies.
 *
 * Only an `Authentication-Results` header whose authserv-id is
 * `mx.google.com` (Gmail's own authentication check) is trusted — a
 * forwarded or relayed copy of someone else's authserv-id block is
 * never evidence of this message's authenticity. A `dkim=pass` must
 * carry a signing domain (`header.i=@…` or `header.d=…`) matching
 * either the sender's own domain or Google Workspace's default
 * `gappssmtp.com` signing domain for it
 * (`<domain-with-dots-as-dashes>.<digits>.gappssmtp.com`) — the only
 * signer example.com currently publishes, since it has no DKIM key of its
 * own and relies on Google's.
 */

/** The only Authentication-Results authserv-id this check trusts. */
export const TRUSTED_AUTHSERV_ID = 'mx.google.com';

/** One `dkim=` clause parsed out of an Authentication-Results header. */
export interface DkimClauseResult {
  /** `pass`, `fail`, `none`, etc. (lowercased). */
  result: string;
  /** The signing domain (`header.i=@…` or `header.d=…`), or null. */
  identityDomain: string | null;
}

/** One parsed Authentication-Results header value. */
export interface ParsedAuthResults {
  /** The authserv-id (first token before the first `;`). */
  authServId: string;
  /** Every `dkim=` clause found in the header. */
  dkimResults: DkimClauseResult[];
}

/**
 * Extract the signing *domain* from one `dkim=` clause segment.
 *
 * `header.d=` is the signing domain outright and is preferred when
 * present. `header.i=` is an identity that may be a bare domain
 * (`@domain`) or a full mailbox (`user@domain`); either way the domain
 * is the part after the *last* `@` (never the whole `header.i` value,
 * which would wrongly include the local part).
 */
function extractIdentityDomain(seg: string): string | null {
  const dMatch = /header\.d=([^\s;]+)/i.exec(seg);
  if (dMatch?.[1]) return dMatch[1].toLowerCase();
  const iMatch = /header\.i=([^\s;]+)/i.exec(seg);
  const identity = iMatch?.[1];
  if (!identity) return null;
  const at = identity.lastIndexOf('@');
  const domain = at >= 0 ? identity.slice(at + 1) : identity;
  return domain ? domain.toLowerCase() : null;
}

/**
 * Parse one `Authentication-Results` header value into its authserv-id
 * and `dkim=` clauses (a header can carry more than one signature
 * result, e.g. one per signing domain).
 */
export function parseAuthenticationResults(value: string): ParsedAuthResults {
  const segments = value
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const authServId = segments[0] ?? '';
  const dkimResults: DkimClauseResult[] = [];
  for (const seg of segments.slice(1)) {
    const method = /^dkim=(\S+)/i.exec(seg);
    if (!method?.[1]) continue;
    dkimResults.push({
      result: method[1].toLowerCase(),
      identityDomain: extractIdentityDomain(seg),
    });
  }
  return { authServId, dkimResults };
}

/**
 * Google Workspace's default DKIM signing domain for a mailbox domain
 * that has no DKIM key of its own: dots replaced by dashes, then
 * `.<digits>.gappssmtp.com`.
 */
export function isGappssmtpAlias(
  identityDomain: string,
  senderDomain: string,
): boolean {
  const withDashes = senderDomain.toLowerCase().replace(/\./g, '-');
  if (!/^[a-z0-9-]+$/.test(withDashes)) return false;
  const pattern = new RegExp(`^${withDashes}\\.\\d+\\.gappssmtp\\.com$`);
  return pattern.test(identityDomain.toLowerCase());
}

/** Whether a dkim identity domain authenticates `senderDomain`. */
export function isDkimDomainMatch(
  identityDomain: string,
  senderDomain: string,
): boolean {
  const identity = identityDomain.toLowerCase();
  const sender = senderDomain.toLowerCase();
  return identity === sender || isGappssmtpAlias(identity, sender);
}

/** Result of {@link checkDkim}. */
export interface DkimCheckResult {
  ok: boolean;
  /** Why it failed; absent when ok. */
  reason?: string;
}

/**
 * Check a message's DKIM authentication against its sender's domain.
 *
 * Only the *topmost* `Authentication-Results` header is trusted — the
 * one Google's receiving MX added last (Gmail's metadata header list
 * preserves arrival order, so it is `authResultsValues[0]`). Any lower
 * header with the same authserv-id can be forged by the sender (it was
 * on the message before Google ever saw it), so it is never consulted,
 * even to look for a `mx.google.com` match further down.
 *
 * @param authResultsValues - Every `Authentication-Results` header value
 *   on the message, topmost first.
 * @param senderDomain - The domain of the From address.
 * @returns ok when the topmost header's authserv-id is `mx.google.com`
 *   and it has a `dkim=pass` clause whose signing domain matches the
 *   sender's domain or its gappssmtp alias; otherwise not ok, with a
 *   reason.
 */
export function checkDkim(
  authResultsValues: readonly string[],
  senderDomain: string,
): DkimCheckResult {
  const topmost = authResultsValues[0];
  if (!topmost) {
    return { ok: false, reason: 'missing Authentication-Results header' };
  }
  const parsed = parseAuthenticationResults(topmost);
  if (parsed.authServId.toLowerCase() !== TRUSTED_AUTHSERV_ID) {
    return {
      ok: false,
      reason: `topmost Authentication-Results authserv-id is "${parsed.authServId}", not ${TRUSTED_AUTHSERV_ID}`,
    };
  }
  for (const clause of parsed.dkimResults) {
    if (
      clause.result === 'pass' &&
      clause.identityDomain &&
      isDkimDomainMatch(clause.identityDomain, senderDomain)
    ) {
      return { ok: true };
    }
  }
  return {
    ok: false,
    reason: `no dkim=pass for domain ${senderDomain} (or its gappssmtp alias) in the topmost Authentication-Results header`,
  };
}
