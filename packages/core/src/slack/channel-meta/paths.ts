/**
 * @module slack/channel-meta/paths
 *
 * Find the directory a Slack message names and make it absolute on this
 * host, the generic way: every root comes from config
 * ({@link PathRoots}), none is a literal here, and the host's path style
 * is passed in (`path.win32` or `path.posix`; live: `node:path`), so the
 * same config shape works on Windows and Linux hosts.
 *
 * - **Windows host** (`path.win32`): a drive path (`j:/a`, `J:\a`) is
 *   absolute; the drive letter is upper-cased and separators become `/`
 *   (`J:/a`, the form Windows instances write in `slack.channels`). A
 *   path starting with `/` names no drive, so it is not absolute here.
 * - **POSIX host** (`path.posix`): a path starting with `/` (`/srv/a`) is
 *   absolute; a drive path names nothing on this host and never resolves.
 * - A path whose first segment is a configured root (`j/a` with
 *   `{"j":"/opt/jeeves/"}` on Linux, or `{"j":"J:/"}` on Windows) is
 *   joined onto that root (`/opt/jeeves/a`, `J:/a`).
 * - A relative path written in back-ticks (`content/a`) is joined onto the
 *   configured `relativeRoot`, if any.
 *
 * In a message, `\` and `/` both separate segments (people type either).
 * Slack markup (`<@U…>`, `<https://…|…>`) is dropped first and `&amp;`,
 * `&lt;`, `&gt;` decoded. The first token that resolves wins; paths with
 * a `..` segment never do. Pure.
 */

import type nodePath from 'node:path';

import { decodeSlack } from './slack-text.js';

/** A path style: `path.win32` or `path.posix` (live: `node:path`). */
export type PlatformPath = typeof nodePath.posix;

/** How the sweep turns a written path into an absolute one. */
export interface PathRoots {
  /** First path segment (lower case) to the absolute directory it names
   * (own keys only are roots). */
  roots: Readonly<Record<string, string>>;
  /** Absolute directory for back-ticked relative paths. */
  relativeRoot?: string;
  /** The host's path style (`path.win32` or `path.posix`). */
  host: PlatformPath;
}

const DRIVE = /^([A-Za-z]):[\\/](.*)$/;

/** Whether a path style is Windows'. */
export const isWindows = (host: PlatformPath): boolean => host.sep === '\\';

/** Separators to `/`, no empty segments, no trailing `/`. */
const cleanSegments = (p: string): string[] =>
  p.split(/[\\/]+/).filter((s) => s.length > 0);

const hasParentSegment = (segments: readonly string[]): boolean =>
  segments.includes('..');

/**
 * An absolute path on this host in the job's canonical form (`X:/a/b` on
 * Windows, `/a/b` on POSIX), or `undefined` when `p` is not absolute
 * there or climbs with `..`.
 *
 * @param p - A path as written.
 * @param host - The host's path style.
 * @returns The canonical path.
 */
export function canonicalAbsolute(
  p: string,
  host: PlatformPath,
): string | undefined {
  if (isWindows(host)) {
    const drive = DRIVE.exec(p);
    if (!drive) return undefined;
    const [, letter = '', rest = ''] = drive;
    const segments = cleanSegments(rest);
    if (hasParentSegment(segments)) return undefined;
    return `${letter.toUpperCase()}:/${segments.join('/')}`;
  }
  if (!p.startsWith('/')) return undefined;
  const segments = cleanSegments(p);
  if (hasParentSegment(segments)) return undefined;
  return `/${segments.join('/')}`;
}

/** `rel` joined onto the absolute `root`, canonical; `undefined` on `..`. */
const joinRoot = (
  root: string,
  rel: string,
  host: PlatformPath,
): string | undefined => {
  const base = canonicalAbsolute(root, host);
  const segments = cleanSegments(rel);
  if (base === undefined || hasParentSegment(segments)) return undefined;
  return canonicalAbsolute(`${base}/${segments.join('/')}`, host);
};

const TRAILING = /[.,;:!?)'"`*_]+$/;
const LEADING = /^[('"`*_]+/;

/**
 * Resolve one token to an absolute path on this host.
 *
 * @param token - The token, without back-ticks.
 * @param roots - Configured roots and the host's path style.
 * @param backticked - Whether it was written as code.
 * @returns The canonical absolute path, or `undefined`.
 */
export function resolveToken(
  token: string,
  roots: PathRoots,
  backticked: boolean,
): string | undefined {
  const t = token.replace(LEADING, '').replace(TRAILING, '');
  if (!/[\\/]/.test(t)) return undefined;
  if (DRIVE.test(t)) return canonicalAbsolute(t, roots.host);
  if (t.startsWith('/'))
    return cleanSegments(t).length >= 2
      ? canonicalAbsolute(t, roots.host)
      : undefined;
  const [first = '', ...rest] = t.split(/[\\/]/);
  const segment = first.toLowerCase();
  // Own keys only: inherited ones (`constructor`, `toString`, …) name
  // no root.
  const root = Object.hasOwn(roots.roots, segment)
    ? roots.roots[segment]
    : undefined;
  if (root !== undefined) return joinRoot(root, rest.join('/'), roots.host);
  if (backticked && roots.relativeRoot !== undefined)
    return joinRoot(roots.relativeRoot, t, roots.host);
  return undefined;
}

/** Slack text without markup, entities decoded. */
const plainText = (text: string): string =>
  decodeSlack(text.replace(/<[^>\n]*>/g, ' '));

/**
 * The first directory a message names, absolute on this host.
 *
 * @param text - The message text (Slack mrkdwn).
 * @param roots - Configured roots and the host's path style.
 * @returns The canonical absolute path, or `undefined` when none resolves.
 */
export function extractPath(
  text: string,
  roots: PathRoots,
): string | undefined {
  for (const m of plainText(text).matchAll(/`([^`\n]+)`|(\S+)/g)) {
    const code = m[1];
    const resolved =
      code === undefined
        ? resolveToken(m[2] ?? '', roots, false)
        : /\s/.test(code.trim())
          ? undefined
          : resolveToken(code.trim(), roots, true);
    if (resolved !== undefined) return resolved;
  }
  return undefined;
}

/**
 * Whether two paths name the same directory on this host: compared in
 * canonical form, case-insensitively on Windows.
 *
 * @param a - One path.
 * @param b - The other.
 * @param host - The host's path style.
 * @returns `true` when they match.
 */
export function samePath(a: string, b: string, host: PlatformPath): boolean {
  const ca = canonicalAbsolute(a, host) ?? a;
  const cb = canonicalAbsolute(b, host) ?? b;
  return isWindows(host) ? ca.toLowerCase() === cb.toLowerCase() : ca === cb;
}
