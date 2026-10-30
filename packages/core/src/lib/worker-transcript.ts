/**
 * @module lib/worker-transcript
 *
 * Token totals from an OpenClaw session transcript (JSON Lines), for
 * worker-session's token accounting. Side effect: one file read.
 */

import fs from 'node:fs';

/**
 * Sum totalTokens from each JSON-Lines entry in a transcript file.
 */
export function getTokensFromTranscript(transcriptPath: string): number {
  try {
    if (!fs.existsSync(transcriptPath)) return 0;

    const lines = fs
      .readFileSync(transcriptPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim());
    let total = 0;

    for (const line of lines) {
      try {
        const entry: unknown = JSON.parse(line);
        if (
          entry &&
          typeof entry === 'object' &&
          'message' in entry &&
          entry.message &&
          typeof entry.message === 'object' &&
          'usage' in entry.message &&
          entry.message.usage &&
          typeof entry.message.usage === 'object' &&
          'totalTokens' in entry.message.usage &&
          typeof entry.message.usage.totalTokens === 'number'
        ) {
          total += entry.message.usage.totalTokens;
        }
      } catch {
        /* skip non-JSON lines */
      }
    }

    return total;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[${new Date().toISOString()}] Failed to read transcript: ${msg}`,
    );
    return 0;
  }
}
