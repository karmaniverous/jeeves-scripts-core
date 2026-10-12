/**
 * @module token-metrics
 *
 * `getTokenMetrics` (root export): reads the pre-rolled hourly token-metrics
 * buckets and the rate card, and aggregates them into a `Costs` report for
 * a time range. A utility: importing it runs nothing. The runnable
 * `admin-report-token-metrics` prints the same report.
 *
 * Reads the buckets and the rate card under `constants().TOKEN_METRICS_DIR`
 * (`paths.tokenMetricsDir` in jeeves-scripts.json, or `TOKEN_METRICS_DIR`).
 */

import { readJson } from '@karmaniverous/jeeves';

import { bucketPath, tsToHour } from './lib/bucket-io.js';
import { loadRateCard } from './lib/rate-card.js';
import type {
  Channels,
  Costs,
  HourlyBucket,
  HourlyModelEntry,
  ModelBucket,
  Models,
  Ref,
  Tokens,
} from './types/token-metrics.js';
import { TOKEN_CATEGORIES } from './types/token-metrics.js';

/**
 * Enumerate all hour strings between two Unix-ms timestamps (inclusive).
 */
function enumHours(fromMs: number, toMs: number): string[] {
  const hours: string[] = [];
  const start = new Date(fromMs);
  start.setUTCMinutes(0, 0, 0);
  const end = new Date(toMs);

  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    hours.push(tsToHour(cursor.getTime()));
    cursor.setUTCHours(cursor.getUTCHours() + 1);
  }
  return hours;
}

/**
 * Create a zeroed Tokens record.
 */
function emptyTokens(): Tokens {
  const t = {} as Tokens;
  for (const cat of TOKEN_CATEGORIES) {
    t[cat] = { count: 0, cost: 0, costPct: 0 };
  }
  return t;
}

/**
 * Accumulate a model entry into a mutable Tokens record.
 */
function accumulateTokens(target: Tokens, source: HourlyModelEntry): void {
  for (const cat of TOKEN_CATEGORIES) {
    target[cat].count += source[cat].count;
    target[cat].cost += source[cat].cost;
  }
}

/**
 * Compute costPct for each token category within a Tokens record.
 */
function finalizePcts(tokens: Tokens, totalCost: number): void {
  for (const cat of TOKEN_CATEGORIES) {
    tokens[cat].costPct = totalCost > 0 ? tokens[cat].cost / totalCost : 0;
  }
}

/**
 * Sum the cost across all token categories.
 */
function tokensCost(tokens: Tokens): number {
  let sum = 0;
  for (const cat of TOKEN_CATEGORIES) {
    sum += tokens[cat].cost;
  }
  return sum;
}

/**
 * Get or create a Tokens entry in a map.
 */
function getOrCreateTokens(map: Map<string, Tokens>, key: string): Tokens {
  const existing = map.get(key);
  if (existing) return existing;
  const entry = emptyTokens();
  map.set(key, entry);
  return entry;
}

/** A report bound: a `Date`, or a string `Date` parses (ISO 8601 date or timestamp). */
export type TokenMetricsBound = Date | string;

/** Options for {@link getTokenMetrics}. */
export interface TokenMetricsOptions {
  /** Start of the range; the hour containing it is included. Default: the beginning of the data. */
  from?: TokenMetricsBound;
  /** End of the range; the hour containing it is included. Default: now. */
  to?: TokenMetricsBound;
}

/** A bound in epoch milliseconds, or `fallback` when absent. */
const boundMs = (
  name: 'from' | 'to',
  value: TokenMetricsBound | undefined,
  fallback: number,
): number => {
  if (value === undefined) return fallback;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (Number.isNaN(ms))
    throw new Error(
      `getTokenMetrics: ${name} is not a valid date: ${String(value)}`,
    );
  return ms;
};

/**
 * Query token metrics over a time range.
 *
 * Reads hourly bucket files from disk and aggregates them into the `Costs`
 * report with per-channel and per-model breakdowns. Every hour from the
 * one containing `from` to the one containing `to` is included.
 *
 * @example
 * ```ts
 * const june = getTokenMetrics({ from: '2026-06-01', to: '2026-06-30T23:59:59Z' });
 * const lastWeek = getTokenMetrics({ from: new Date(Date.now() - 7 * 86_400_000) });
 * ```
 * @throws When `from` or `to` is not a valid date.
 */
export function getTokenMetrics(options: TokenMetricsOptions = {}): Costs {
  const fromMs = boundMs('from', options.from, 0);
  const toMs = boundMs('to', options.to, Date.now());

  const hours = enumHours(fromMs, toMs);

  // Accumulate raw data
  const channelTokens = new Map<string, Map<string, Tokens>>();
  const globalModelTokens = new Map<string, Tokens>();

  for (const hour of hours) {
    const bucket = readJson<HourlyBucket | null>(bucketPath(hour), null);
    if (!bucket) continue;

    for (const [chanKey, chanData] of Object.entries(bucket.channels)) {
      let chanModels = channelTokens.get(chanKey);
      if (!chanModels) {
        chanModels = new Map();
        channelTokens.set(chanKey, chanModels);
      }

      for (const [modelKey, modelData] of Object.entries(chanData.models)) {
        // Per-channel per-model
        const chanModelTokens = getOrCreateTokens(chanModels, modelKey);
        accumulateTokens(chanModelTokens, modelData);

        // Global per-model
        const globalTokens = getOrCreateTokens(globalModelTokens, modelKey);
        accumulateTokens(globalTokens, modelData);
      }
    }
  }

  // Compute totals and percentages
  let grandTotal = 0;
  for (const tokens of globalModelTokens.values()) {
    grandTotal += tokensCost(tokens);
  }

  // Build global models
  const models: Models = {};
  for (const [modelKey, tokens] of globalModelTokens) {
    const cost = tokensCost(tokens);
    finalizePcts(tokens, cost);
    const bucket: ModelBucket = {
      cost,
      costPct: grandTotal > 0 ? cost / grandTotal : 0,
      tokens,
    };
    models[modelKey] = bucket;
  }

  // Build channels
  const channels: Channels = {};
  for (const [chanKey, chanModels] of channelTokens) {
    let chanCost = 0;
    const chanModelBuckets: Models = {};

    for (const [modelKey, tokens] of chanModels) {
      const cost = tokensCost(tokens);
      chanCost += cost;
      finalizePcts(tokens, cost);
      chanModelBuckets[modelKey] = {
        cost,
        costPct: 0, // filled below
        tokens,
      };
    }

    // Fill model costPct within channel
    for (const mb of Object.values(chanModelBuckets)) {
      mb.costPct = chanCost > 0 ? mb.cost / chanCost : 0;
    }

    channels[chanKey] = {
      channelName: chanKey,
      cost: chanCost,
      costPct: grandTotal > 0 ? chanCost / grandTotal : 0,
      models: chanModelBuckets,
    };
  }

  // Build ref from rate card
  const rateCard = loadRateCard();
  const ref: Ref = {};
  for (const [model, rates] of Object.entries(rateCard.models)) {
    ref[model] = { ...rates };
  }

  return { channels, cost: grandTotal, models, ref };
}
