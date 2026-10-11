/**
 * @module config/check
 *
 * `configCheck` (design §5, §6; R30): validates `jeeves-scripts.json`
 * against the schema and its silo references. It is the root export's
 * config check and checks core's schema only; the CLI's `config check`
 * (`cli/config-check.ts`) runs it and then loads the instance plugin, so
 * the plugin's `configSchema` also validates the `local` block.
 */

import {
  getLoadedConfigPath,
  loadConfig,
  type LoadConfigOptions,
  resetConfig,
} from './loader.js';
import { isKnownSilo, siloRouting } from './silo-router.js';

/** Outcome of {@link configCheck}. */
export interface ConfigCheckResult {
  /** True when the config is valid and every silo reference is known. */
  ok: boolean;
  /** The file that was checked, when it could be resolved and read. */
  configPath?: string;
  /** One message per problem; empty when `ok`. */
  errors: string[];
}

/**
 * Collect every job/dispatcher `silo` reference in the config and
 * validate it is known (Decision 28: "`config check` fails on a
 * dispatcher or job naming an unknown silo").
 */
const checkJobSilos = (options: LoadConfigOptions): string[] => {
  const config = loadConfig(options);
  const errors: string[] = [];
  for (const [id, job] of Object.entries(config.jobs)) {
    if (job.silo !== undefined && !isKnownSilo(job.silo, options)) {
      errors.push(
        `jobs.${id}.silo: unknown silo "${job.silo}". Configured silos: ${Object.keys(siloRouting(options).silos).join(', ') || '(none)'}.`,
      );
    }
  }
  return errors;
};

/**
 * Validate `jeeves-scripts.json`: schema (including the secret-literal
 * guard) and silo references. Never throws; failures are collected in
 * `errors`.
 */
export const configCheck = (
  options: LoadConfigOptions = {},
): ConfigCheckResult => {
  resetConfig();
  try {
    loadConfig(options);
  } catch (e) {
    return {
      ok: false,
      errors: [e instanceof Error ? e.message : String(e)],
    };
  }
  const errors = checkJobSilos(options);
  return {
    ok: errors.length === 0,
    configPath: getLoadedConfigPath() ?? undefined,
    errors,
  };
};
