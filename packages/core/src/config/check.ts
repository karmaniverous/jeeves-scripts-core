/**
 * @module config/check
 *
 * `configCheck` (design §5, §6; R10, R30): validates `jeeves-scripts.json`
 * against the schema and its silo references (`jobs.<id>.silo` and
 * `integrations.x.accounts.<handle>.silo`). It is the root export's
 * config check and checks core's schema only; the CLI's `config check`
 * (`cli/config-check.ts`) runs it and then loads the instance plugin, so
 * the plugin's `configSchema` also validates the `local` block.
 */

import {
  getLoadedConfigPath,
  loadConfig,
  type LoadConfigOptions,
  resetConfig,
  resolveConfig,
  type ResolvedConfig,
} from './loader.js';
import { isKnownSilo, siloRouting } from './silo-router.js';

/** Outcome of {@link configCheck}. */
export interface ConfigCheckResult {
  /** True when the config is valid and every silo reference is known. */
  ok: boolean;
  /** The file that was checked, when its location could be resolved. */
  configPath?: string;
  /** Where that file came from (#57), when its location could be resolved. */
  source?: Pick<ResolvedConfig, 'source' | 'pointer'>;
  /** One message per problem; empty when `ok`. */
  errors: string[];
}

/**
 * Collect every `silo` reference in the config (a job's or dispatcher's
 * `jobs.<id>.silo`, an X account's `integrations.x.accounts.<handle>.silo`)
 * and validate it is known (Decision 28, R10).
 */
const checkSilos = (options: LoadConfigOptions): string[] => {
  const config = loadConfig(options);
  const refs: [string, string | undefined][] = [
    ...Object.entries(config.jobs).map(
      ([id, job]): [string, string | undefined] => [
        `jobs.${id}.silo`,
        job.silo,
      ],
    ),
    ...Object.entries(config.integrations.x.accounts).map(
      ([handle, account]): [string, string | undefined] => [
        `integrations.x.accounts.${handle}.silo`,
        account.silo,
      ],
    ),
  ];
  const known = Object.keys(siloRouting(options).silos).join(', ') || '(none)';
  return refs
    .filter(
      (ref): ref is [string, string] =>
        ref[1] !== undefined && !isKnownSilo(ref[1], options),
    )
    .map(
      ([where, silo]) =>
        `${where}: unknown silo "${silo}". Configured silos: ${known}.`,
    );
};

/** The config file location, or `undefined` when it can't be resolved. */
const locate = (options: LoadConfigOptions): ResolvedConfig | undefined => {
  try {
    return resolveConfig(options);
  } catch {
    return undefined;
  }
};

/** `configPath` and `source` of a resolved location, for a result. */
const located = (
  resolved: ResolvedConfig | undefined,
): Pick<ConfigCheckResult, 'configPath' | 'source'> =>
  resolved === undefined
    ? {}
    : {
        configPath: resolved.path,
        source: {
          source: resolved.source,
          ...(resolved.pointer === undefined
            ? {}
            : { pointer: resolved.pointer }),
        },
      };

/**
 * Where a checked config came from, for people (#57): `pointer <file>`,
 * `JEEVES_SCRIPTS_CONFIG`, `--config`, or `legacy repo file`.
 */
export const describeConfigSource = (
  source: ConfigCheckResult['source'],
): string | undefined => {
  switch (source?.source) {
    case 'pointer':
      return `pointer ${source.pointer ?? ''}`.trim();
    case 'environment':
      return 'JEEVES_SCRIPTS_CONFIG';
    case 'option':
      return '--config';
    case 'legacy':
      return 'legacy repo file';
    default:
      return undefined;
  }
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
      ...located(locate(options)),
      errors: [e instanceof Error ? e.message : String(e)],
    };
  }
  const errors = checkSilos(options);
  return {
    ok: errors.length === 0,
    ...located(locate(options)),
    configPath: getLoadedConfigPath() ?? undefined,
    errors,
  };
};
