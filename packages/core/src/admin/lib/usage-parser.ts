/**
 * @module usage-parser
 *
 * OpenClaw usage parsing — extracts token usage from OpenClaw
 * gateway transcript JSONL lines and normalizes into the structured
 * record used by the hourly bucket pipeline.
 *
 * Shared by collect-token-metrics and recalculate-token-metrics.
 */

import type { TokenCategory } from '../types/token-metrics.js';
import { TOKEN_CATEGORIES } from '../types/token-metrics.js';
import { computeCosts } from './rate-card.js';

/** Raw usage shape from OpenClaw transcripts. */
export interface RawUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
}

/**
 * Parse a single JSONL line for usage data.
 * Returns null if the line has no extractable usage.
 */
export function parseUsageLine(line: string): {
  tsMs: number;
  model: string;
  provider: string;
  rawUsage: RawUsage;
} | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (parsed.type !== 'message') return null;

  const msg = parsed.message as Record<string, unknown> | undefined;
  if (!msg?.usage) return null;

  const usage = msg.usage as RawUsage;
  if (!usage.cost && !usage.totalTokens) return null;

  const model = typeof msg.model === 'string' ? msg.model : 'unknown';
  const provider = typeof msg.provider === 'string' ? msg.provider : 'unknown';

  // Determine timestamp: prefer outer (ISO string), fall back to message (ms)
  let tsMs: number;
  const outerTs = parsed.timestamp;
  if (typeof outerTs === 'string') {
    tsMs = new Date(outerTs).getTime();
  } else if (typeof outerTs === 'number') {
    tsMs = outerTs > 1e12 ? outerTs : outerTs * 1000;
  } else {
    const msgTs = msg.timestamp;
    if (typeof msgTs === 'number') {
      tsMs = msgTs > 1e12 ? msgTs : msgTs * 1000;
    } else {
      return null;
    }
  }

  if (isNaN(tsMs)) return null;

  return { tsMs, model, provider, rawUsage: usage };
}

/**
 * Convert raw usage into the structured record we accumulate.
 * Costs are computed from the rate card, not from OpenClaw's per-message costs.
 */
export function normalizeUsage(
  raw: RawUsage,
  modelKey: string,
): Record<TokenCategory, { count: number; cost: number }> {
  const counts = {} as Record<TokenCategory, number>;
  for (const cat of TOKEN_CATEGORIES) {
    const count = raw[cat];
    counts[cat] = typeof count === 'number' ? count : 0;
  }

  const costs = computeCosts(modelKey, counts);
  const result = {} as Record<TokenCategory, { count: number; cost: number }>;
  for (const cat of TOKEN_CATEGORIES) {
    result[cat] = { count: counts[cat], cost: costs[cat] };
  }
  return result;
}
