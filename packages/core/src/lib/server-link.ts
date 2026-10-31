/**
 * @module lib/server-link
 *
 * A report file's jeeves-server insider link, resolved by the server
 * itself (`GET /api/resolve-path` on its local API): the server owns the
 * mapping from its roots to browse paths, the URL encoding and its
 * `publicUrl`, so this works on any host. The API address and the insider
 * key come from jeeves-server's own config (`port`, and a named machine
 * key in `keys`, a seed string or `{ key }`); the key is derived with
 * `computeInsiderKey` from `@karmaniverous/jeeves` (Decision 72), exactly
 * as the server checks it. Never posts a filesystem path to Slack: any
 * failure throws. A preview resolves the link before its worker runs and
 * warns instead of failing ({@link linkBeforeWorker}).
 */

import path from 'node:path';

import { computeInsiderKey, getErrorMessage } from '@karmaniverous/jeeves';
import { z } from 'zod';

import { readComponentConfig } from './component-config.js';

const serverConfigSchema = z.looseObject({
  port: z.number().int().positive().optional(),
  keys: z
    .record(
      z.string(),
      z.union([z.string(), z.looseObject({ key: z.string() })]),
    )
    .optional(),
});

/** The jeeves-server config fields the link needs. */
export type ServerLinkConfig = z.infer<typeof serverConfigSchema>;

/** What a caller needs to call jeeves-server's API. */
export interface ServerAccess {
  /** Local API base URL, no trailing slash. */
  apiUrl: string;
  /** Insider key derived from the machine key's seed (`?k=`). */
  insiderKey: string;
}

/**
 * The API base URL and insider key for a named machine key.
 *
 * @param config - jeeves-server's config, or `undefined` if not found.
 * @param keyName - The machine key in the server's `keys`.
 * @returns The access details.
 * @throws Error naming what is missing.
 */
export function serverAccessFrom(
  config: ServerLinkConfig | undefined,
  keyName: string,
): ServerAccess {
  if (!config) throw new Error('jeeves-server config not found');
  if (!config.port) throw new Error('jeeves-server config has no port');
  const entry = config.keys?.[keyName];
  const seed = typeof entry === 'string' ? entry : entry?.key;
  if (!seed)
    throw new Error(`jeeves-server config has no machine key "${keyName}"`);
  return {
    apiUrl: `http://127.0.0.1:${String(config.port)}`,
    insiderKey: computeInsiderKey(seed),
  };
}

/** {@link serverAccessFrom} over jeeves-server's own config file. */
export const readServerAccess = (keyName: string): ServerAccess =>
  serverAccessFrom(readComponentConfig('server', serverConfigSchema), keyName);

/** The parts of a `fetch` response {@link resolvePublicUrl} reads. */
export interface FetchResponse {
  /** Whether the status is 2xx. */
  ok: boolean;
  /** The HTTP status. */
  status: number;
  /** The body parsed as JSON. */
  json: () => Promise<unknown>;
}

/** `fetch`, injectable for tests; `signal` aborts it (the timeout). */
export type Fetch = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<FetchResponse>;

/** How long {@link resolvePublicUrl} waits for jeeves-server, answer
 * included (it is local, so a long wait means it is hung). */
export const SERVER_LINK_TIMEOUT_MS = 10_000;

/**
 * The public insider URL jeeves-server gives for a path.
 *
 * @param fetchFn - `fetch`.
 * @param access - API base URL and insider key.
 * @param fsPath - Absolute filesystem path under one of the server's roots.
 * @param timeoutMs - How long to wait for the answer (default
 *   `SERVER_LINK_TIMEOUT_MS`, 10 s).
 * @returns The `publicUrl` from the server's answer.
 * @throws Error on a non-OK answer (e.g. 404: not under any root), when
 *   the server has no `publicUrl` configured, or when it doesn't answer in
 *   time (the message names the path, never the URL or key).
 */
export async function resolvePublicUrl(
  fetchFn: Fetch,
  access: ServerAccess,
  fsPath: string,
  timeoutMs = SERVER_LINK_TIMEOUT_MS,
): Promise<string> {
  const query = new URLSearchParams({ fsPath, k: access.insiderKey });
  const signal = AbortSignal.timeout(timeoutMs);
  let res: FetchResponse;
  let body: { publicUrl?: unknown; error?: unknown };
  try {
    res = await fetchFn(
      `${access.apiUrl}/api/resolve-path?${query.toString()}`,
      { signal },
    );
    body = (await res.json().catch((e: unknown) => {
      if (signal.aborted) throw e;
      return {};
    })) as typeof body;
  } catch (e) {
    if (!signal.aborted) throw e;
    throw new Error(
      `jeeves-server did not answer within ${String(timeoutMs)} ms resolving ${fsPath}`,
      { cause: e },
    );
  }
  if (!res.ok)
    throw new Error(
      `jeeves-server could not resolve ${fsPath} (HTTP ${String(res.status)}${typeof body.error === 'string' ? `: ${body.error}` : ''})`,
    );
  if (typeof body.publicUrl !== 'string' || !body.publicUrl)
    throw new Error(
      'jeeves-server publicUrl is not configured; refusing to post a filesystem path to Slack',
    );
  return body.publicUrl;
}

/**
 * A Slack mrkdwn link.
 *
 * @param url - The link target.
 * @param label - The visible text.
 * @returns `<url|label>`.
 */
export const slackLink = (url: string, label: string): string =>
  `<${url}|${label}>`;

/** A report file's Slack mrkdwn insider link, resolved with a machine key. */
export type ReportLink = (
  file: string,
  serverKeyName: string,
) => Promise<string>;

/** What a preview shows when the link can't be resolved. */
export const NO_LINK = '(no link)';

/**
 * The link label: a title and the report's date (the file's base name;
 * `path.win32` splits on both separators, so the label is the same on
 * every host).
 *
 * @param title - The report's title.
 * @param file - The report file.
 * @returns `<title> — <YYYY-MM-DD>`.
 */
export const reportLinkLabel = (title: string, file: string): string =>
  `${title} \u2014 ${path.win32.basename(file, '.md')}`;

/**
 * The live {@link ReportLink} for a report title: global `fetch` and
 * jeeves-server's own config.
 *
 * @param title - The report's title.
 * @returns The link resolver.
 */
export const liveReportLink =
  (title: string): ReportLink =>
  async (file, serverKeyName) =>
    slackLink(
      await resolvePublicUrl(fetch, readServerAccess(serverKeyName), file),
      reportLinkLabel(title, file),
    );

/** What {@link linkBeforeWorker} needs. */
export interface LinkRequest {
  /** The resolver. */
  reportLink: ReportLink;
  /** The report file the run will write. */
  file: string;
  /** The jeeves-server machine key name. */
  serverKeyName: string;
  /** A preview run: warn instead of failing. */
  preview: boolean;
  /** The runnable's log label. */
  scriptName: string;
  /** Log sink. */
  log: (line: string) => void;
}

/**
 * Resolve the report's link before the worker runs, so a live run whose
 * report directory the server can't link fails before spending a worker.
 *
 * @param request - Resolver, file, key, run kind and log.
 * @returns The link; `NO_LINK` (no URL, a placeholder label) when a
 *   preview can't resolve it.
 * @throws Error when a live run can't resolve it.
 */
export async function linkBeforeWorker(request: LinkRequest): Promise<string> {
  const { file, preview } = request;
  try {
    return await request.reportLink(file, request.serverKeyName);
  } catch (e) {
    if (!preview) throw e;
    request.log(
      `[warn] ${request.scriptName}: no insider link for ${file}; the live run would fail: ${getErrorMessage(e)}`,
    );
    return NO_LINK;
  }
}
