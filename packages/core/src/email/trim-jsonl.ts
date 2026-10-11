/**
 * @module trim-jsonl
 *
 * Age-based trimming of the email event logs (`<account>.jsonl` etc.)
 * in EMAIL_EVENTS_DIR. Lines whose `at` timestamp is older than the
 * cutoff are dropped. Every other line is kept: unparseable JSON, and
 * lines whose `at` is missing, not a string or not a valid date (their
 * age can't be established). `_runs-*.jsonl` run logs are never trimmed.
 *
 * Called by email/poll.ts after each run.
 */

import fs from 'node:fs';
import path from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * True only when the line is JSON with an `at` that parses to a time
 * before `cutoff`. A line whose age can't be established is kept.
 */
function isOlderThan(line: string, cutoff: number): boolean {
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return false;
  }
  if (typeof obj !== 'object' || obj === null || !('at' in obj)) return false;
  const { at } = obj;
  if (typeof at !== 'string') return false;
  const time = Date.parse(at);
  return Number.isFinite(time) && time < cutoff;
}

/**
 * Drop lines older than `maxDays` from every `*.jsonl` file in `dir`
 * except `_runs-*.jsonl`. A missing directory is a no-op.
 */
export function trimJsonlFiles(
  dir: string,
  maxDays: number,
  now: number = Date.now(),
): void {
  if (!fs.existsSync(dir)) return;
  const cutoff = now - maxDays * DAY_MS;

  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.jsonl')) continue;
    if (entry.startsWith('_runs-')) continue;

    const filePath = path.join(dir, entry);
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const kept = content
      .split('\n')
      .filter((line) => line.trim() && !isOlderThan(line, cutoff));

    fs.writeFileSync(filePath, kept.length > 0 ? kept.join('\n') + '\n' : '');
  }
}
