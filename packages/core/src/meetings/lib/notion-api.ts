/**
 * @module notion-api
 *
 * Shared Notion API HTTP helpers. Used by both the ingest-notion entry
 * point and the notion-inbox-processor library module.
 *
 * Config dependencies: constants().NOTION_API_KEY_PATH, constants().NOTION_VERSION from constants.ts.
 * The API key file must exist at constants().NOTION_API_KEY_PATH before any Notion
 * scripts will work.
 */

import fs from 'node:fs';
import https from 'node:https';

import { constants } from '../../lib/constants.js';

/** Read a text file and return its trimmed contents. */
export function readTextFile(p: string): string {
  return fs.readFileSync(p, 'utf8').trim();
}

/** Make an authenticated Notion API request. */
export function notionRequest(
  method: string,
  endpoint: string,
  body?: unknown,
): Promise<unknown> {
  const key = readTextFile(constants().NOTION_API_KEY_PATH);
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      'Notion-Version': constants().NOTION_VERSION,
      'Content-Type': 'application/json',
    };
    if (data) headers['Content-Length'] = String(Buffer.byteLength(data));

    const req = https.request(
      {
        hostname: 'api.notion.com',
        port: 443,
        path: endpoint,
        method,
        headers,
      },
      (res) => {
        let resp = '';
        res.on('data', (c: Buffer) => (resp += c.toString()));
        res.on('end', () => {
          let parsed: unknown;
          try {
            parsed = resp ? (JSON.parse(resp) as unknown) : null;
          } catch {
            parsed = { raw: resp };
          }
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const msg =
              parsed && typeof parsed === 'object' && 'message' in parsed
                ? (parsed as { message: string }).message
                : resp;
            reject(
              new Error(
                `Notion ${method} ${endpoint} failed (${String(res.statusCode ?? 'unknown')}): ${msg}`,
              ),
            );
          }
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
