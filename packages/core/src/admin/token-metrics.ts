#!/usr/bin/env tsx
/**
 * @module token-metrics
 *
 * Token metrics query — reads pre-rolled hourly buckets and aggregates
 * into a `Costs` report for a given time range.
 *
 * Serves as both an importable function and a CLI entry point:
 * `tsx src/admin/token-metrics.ts [--from ISO] [--to ISO]`
 *
 * Config dependencies: TOKEN_METRICS_DIR, TOKEN_RATES_PATH from constants.ts.
 */

import { getArg, readJson } from '@karmaniverous/jeeves';

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

/**
 * Query token metrics over a time range.
 *
 * Reads hourly bucket files from disk and aggregates into
 * the Costs return type with per-channel and per-model breakdowns.
 */
export function getTokenMetrics(options?: {
  fromTs?: number;
  toTs?: number;
}): Costs {
  const fromMs = (options?.fromTs ?? 0) * 1000;
  const toMs = (options?.toTs ?? Date.now() / 1000) * 1000;

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

// ---- CLI mode ----

const isMain = process.argv[1]?.endsWith('token-metrics.ts');

if (isMain) {
  const fromArg = getArg(process.argv, '--from', '');
  const toArg = getArg(process.argv, '--to', '');

  const fromTs = fromArg
    ? Math.floor(new Date(fromArg).getTime() / 1000)
    : undefined;
  const toTs = toArg ? Math.floor(new Date(toArg).getTime() / 1000) : undefined;

  const costs = getTokenMetrics({ fromTs, toTs });
  console.log(JSON.stringify(costs, null, 2));
}
