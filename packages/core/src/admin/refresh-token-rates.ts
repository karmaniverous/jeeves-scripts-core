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
 * Config dependencies: constants().TOKEN_RATES_PATH and TOKEN_RATES_PENDING_PATH
 * (under `paths.tokenMetricsDir` in jeeves-scripts.json (or `TOKEN_METRICS_DIR`)), and
 * constants().TOKEN_RATES_SEED_PATH (core's `config/token-rates.seed.json`).
 */

import { atomicWrite } from '@karmaniverous/jeeves';

import { argFlag } from '../lib/args.js';
import { constants } from '../lib/constants.js';
import { defineRunnable } from '../runnables/define-runnable.js';
import { fetchOpenRouterRates, httpGetJson } from './lib/openrouter-pricing.js';
import {
  readPendingModels,
  writePendingModels,
} from './lib/rate-card-pending.js';
import { readRateCardFile } from './lib/rate-card-schema.js';
import { ensureRateCard } from './lib/rate-card-seed.js';
import {
  type RefreshRatesDeps,
  refreshTokenRatesMain,
} from './lib/refresh-rates-run.js';

export default defineRunnable({
  id: 'admin-refresh-token-rates',
  domain: 'admin',
  name: 'admin/refresh-token-rates',
  flags: {
    dryRun: argFlag('--dry-run', 'Report the rate changes; write nothing'),
  },
  run: async ({ flags }) => {
    await refreshTokenRatesMain(flags, refreshRatesDeps());
  },
});

/** The live collaborators, from config when the job runs. */
export function refreshRatesDeps(
  httpGet: typeof httpGetJson = httpGetJson,
): RefreshRatesDeps {
  return {
    ensure: () => {
      ensureRateCard(
        constants().TOKEN_RATES_PATH,
        constants().TOKEN_RATES_SEED_PATH,
      );
    },
    read: () => readRateCardFile(constants().TOKEN_RATES_PATH),
    fetchRates: async (id) =>
      (await fetchOpenRouterRates(id, httpGet))?.rates ?? null,
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
  };
}
