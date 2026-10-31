/**
 * @module notion-api
 *
 * Shared Notion API HTTP helpers. Used by both the ingest-notion entry
 * point and the notion-inbox-processor library module.
 *
 * Config dependencies: `{paths.credentialsDir}/notion-api-key` (constants().NOTION_API_KEY_PATH)
 * and `integrations.notion.version` in the instance config.
 * The API key file must exist at constants().NOTION_API_KEY_PATH before any Notion
 * scripts will work.
 */

import fs from 'node:fs';

import { constants } from '../../lib/constants.js';

/** Read a text file and return its trimmed contents. */
export function readTextFile(p: string): string {
  return fs.readFileSync(p, 'utf8').trim();
}

/**
 * Make an authenticated Notion API request; resolves to the parsed JSON
 * body (`{ raw }` when not JSON, `null` when empty).
 *
 * @throws On a non-2xx status, with Notion's message.
 */
export async function notionRequest(
  method: string,
  endpoint: string,
  body?: unknown,
): Promise<unknown> {
  const key = readTextFile(constants().NOTION_API_KEY_PATH);
  const data = body ? JSON.stringify(body) : null;
  const res = await fetch(`https://api.notion.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Notion-Version': constants().NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    ...(data ? { body: data } : {}),
  });
  const resp = await res.text();
  let parsed: unknown;
  try {
    parsed = resp ? (JSON.parse(resp) as unknown) : null;
  } catch {
    parsed = { raw: resp };
  }
  if (res.ok) return parsed;
  const msg =
    parsed && typeof parsed === 'object' && 'message' in parsed
      ? (parsed as { message: string }).message
      : resp;
  throw new Error(
    `Notion ${method} ${endpoint} failed (${String(res.status)}): ${msg}`,
  );
}
