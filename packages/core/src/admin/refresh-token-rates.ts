#!/usr/bin/env tsx
/**
 * @module refresh-token-rates
 *
 * Seeds the token rate card if missing, then refreshes every model's
 * $/MTok rates from the public OpenRouter model endpoint
 * (openrouter.ai/api/v1/model/<id>), adding models the collector recorded
 * as pending (constants().TOKEN_RATES_PENDING_PATH). No LLM session is involved.
 * Changed rates are written atomically; the job fails if any provider
 * model can't be resolved, after applying the rest. See
 * lib/refresh-rates-run.ts for the full contract.
 *
 * `--dry-run` fetches and prints the changes without writing.
 *
 * Config dependencies: constants().TOKEN_RATES_PATH, constants().TOKEN_RATES_PENDING_PATH,
 * constants().TOKEN_RATES_SEED_PATH from
 * constants.ts.
 */

import { atomicWrite, runScript } from '@karmaniverous/jeeves';

import { constants } from '../lib/constants.js';
import { fetchOpenRouterRates, httpGetJson } from './lib/openrouter-pricing.js';
import {
  readPendingModels,
  writePendingModels,
} from './lib/rate-card-pending.js';
import { readRateCardFile } from './lib/rate-card-schema.js';
import { ensureRateCard } from './lib/rate-card-seed.js';
import { refreshTokenRatesMain } from './lib/refresh-rates-run.js';

runScript('admin/refresh-token-rates', async () => {
  await refreshTokenRatesMain(process.argv, {
    ensure: () => {
      ensureRateCard(
        constants().TOKEN_RATES_PATH,
        constants().TOKEN_RATES_SEED_PATH,
      );
    },
    read: () => readRateCardFile(constants().TOKEN_RATES_PATH),
    fetchRates: async (id) =>
      (await fetchOpenRouterRates(id, httpGetJson))?.rates ?? null,
    write: (card) => {
      atomicWrite(
        constants().TOKEN_RATES_PATH,
        `${JSON.stringify(card, null, 1)}\n`,
      );
    },
    readPending: () => readPendingModels(constants().TOKEN_RATES_PENDING_PATH),
    writePending: (ids) => {
      writePendingModels(constants().TOKEN_RATES_PENDING_PATH, ids);
    },
    now: () => new Date().toISOString(),
  });
});
