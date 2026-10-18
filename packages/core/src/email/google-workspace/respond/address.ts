/**
 * @module respond/address
 *
 * Email address-list parsing for RFC 5322 `From` / `To` / `Cc` header
 * values: quoted display names (which may contain commas) and angle
 * brackets, split correctly on top-level commas only. Pure, no
 * dependencies.
 *
 * Used by email/respond/qualify.ts to decide whether a sender is
 * allowed and whether the mailbox is addressed in To/Cc.
 */

/** A parsed `Name <email>` (or bare `email`) address. */
export interface ParsedAddress {
  /** Display name, or '' when there is none. */
  name: string;
  /** Lowercased email address. */
  email: string;
}

const EMAIL_PATTERN = /^[^\s<>@"]+@[^\s<>@"]+\.[^\s<>@"]+$/;

/**
 * Split a header value into top-level comma-separated address segments.
 * Commas inside a quoted display name (`"Doe, John" <...>`) or inside
 * angle brackets are not treated as separators.
 */
export function splitAddressList(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuotes = false;
  let current = '';
  let prev = '';
  for (const ch of value) {
    const escaped = prev === '\\';
    prev = ch;
    if (ch === '"' && !escaped) inQuotes = !inQuotes;
    if (!inQuotes) {
      if (ch === '<') depth++;
      else if (ch === '>') depth = Math.max(0, depth - 1);
    }
    if (ch === ',' && !inQuotes && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * The segment with every quoted string (display-name content, honouring
 * backslash escapes) blanked out, same length, so positions still line up
 * with the original. An unterminated quote blanks to the end.
 */
function blankQuoted(segment: string): string {
  let out = '';
  let inQuotes = false;
  let escaped = false;
  for (const ch of segment) {
    if (inQuotes) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inQuotes = false;
      out += ' ';
    } else {
      if (ch === '"') inQuotes = true;
      out += ch === '"' ? ' ' : ch;
    }
  }
  return out;
}

/** The angle address outside quoted text, if exactly one; `null` if ambiguous. */
function angleAddr(segment: string): RegExpExecArray | null | 'ambiguous' {
  const bare = blankQuoted(segment);
  const matches = [...bare.matchAll(/<([^<>]*)>/g)];
  if (matches.length > 1 || /[<>]/.test(bare.replace(/<[^<>]*>/g, '')))
    return 'ambiguous';
  return matches[0] ?? null;
}

/**
 * Extract and validate the email address from one address segment
 * (`Name <email>` or a bare `email`). Text inside a quoted display name
 * is never taken as the address, so `"Alias <a@x.com>" <b@x.com>` is
 * `b@x.com`; a segment with more than one angle address is ambiguous.
 *
 * @returns The lowercased email address, or null when the segment does
 *   not contain exactly one that looks valid.
 */
export function extractEmailAddress(segment: string): string | null {
  const angle = angleAddr(segment);
  if (angle === 'ambiguous') return null;
  const candidate = (
    angle?.[1] ?? segment.trim().replace(/^"([^"]*)"$/, '$1')
  ).trim();
  return EMAIL_PATTERN.test(candidate) ? candidate.toLowerCase() : null;
}

/**
 * Parse every address out of a header value (`To`/`Cc`-style list).
 *
 * @returns Lowercased email addresses; segments that don't parse are
 *   dropped rather than failing the whole header.
 */
export function parseAddressList(value: string): string[] {
  if (!value) return [];
  return splitAddressList(value)
    .map(extractEmailAddress)
    .filter((e): e is string => e !== null);
}

/**
 * Parse the first address out of a header value (`From`-style single
 * address, with an optional display name).
 *
 * @returns The parsed address, or null when there isn't one.
 */
export function parseFirstAddress(value: string): ParsedAddress | null {
  if (!value) return null;
  const [first] = splitAddressList(value);
  if (!first) return null;
  const email = extractEmailAddress(first);
  if (!email) return null;
  const angle = angleAddr(first);
  const name =
    angle && angle !== 'ambiguous'
      ? first
          .slice(0, angle.index)
          .trim()
          .replace(/^"+|"+$/g, '')
          .trim()
      : '';
  return { name, email };
}
