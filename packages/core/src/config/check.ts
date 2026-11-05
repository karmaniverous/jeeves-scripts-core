/**
 * @module config/check
 *
 * `configCheck` (design §5, §6; R10, R30): validates the instance config
 * against the schema, its silo references (`jobs.<id>.silo` and
 * `integrations.x.accounts.<handle>.silo`) and the gateway Slack
 * accounts `slack.channelMeta` names (`reportAccount`,
 * `reportTextAccounts`) and `skillReview` posts with (`reportAccount`;
 * Decision 76). It is the root export's
 * config check and checks core's schema only; the CLI's `config check`
 * (`cli/config-check.ts`) runs it and then loads the instance plugin, so
 * the plugin's `configSchema` also validates the `local` block.
 */

import { slackBotTokens } from '../lib/openclaw-config.js';
import {
  getLoadedConfigPath,
  loadConfig,
  type LoadConfigOptions,
  resetConfig,
  resolveConfig,
  type ResolvedConfig,
} from './loader.js';
import { isKnownSilo, siloRouting } from './silo-router.js';
import { skillReviewAccountProblem } from './skill-review-schema.js';
import { slackAccountsProblem } from './slack-channel-meta-schema.js';

/** What {@link configCheck} reads besides the config. */
export interface ConfigCheckDeps {
  /** The gateway Slack accounts, read only when `slack.channelMeta`
   * names one or a `skillReview` block is present. Default: OpenClaw's configured bot tokens
   * (`slackBotTokens`). */
  slackAccounts?: () => readonly string[];
}

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
  /**
   * What could not be checked here and does not fail the check: the
   * gateway Slack accounts when they can't be read (a host without
   * OpenClaw, such as CI). The job checks them again when it runs.
   */
  warnings: string[];
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

/**
 * The accounts `slack.channelMeta` and `skillReview` name that the gateway
 * lacks (errors). When the gateway's accounts can't be read at all, the
 * blocks that name one are reported as warnings instead: the check can't
 * tell, and the job checks again when it runs.
 */
const checkSlackAccounts = (
  options: LoadConfigOptions,
  deps: ConfigCheckDeps,
): Pick<ConfigCheckResult, 'errors' | 'warnings'> => {
  const config = loadConfig(options);
  const read = deps.slackAccounts ?? (() => Object.keys(slackBotTokens()));
  const meta = config.slack.channelMeta;
  const review = config.skillReview;
  const naming = [
    // as slackAccountsProblem: a block names accounts by reportAccount or
    // a non-empty reportTextAccounts
    meta?.reportAccount !== undefined ||
    (meta?.reportTextAccounts?.length ?? 0) > 0
      ? 'slack.channelMeta'
      : undefined,
    review === undefined ? undefined : 'skillReview',
  ].filter((b) => b !== undefined);
  if (naming.length === 0) return { errors: [], warnings: [] };
  let known: readonly string[];
  try {
    known = read();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return {
      errors: [],
      warnings: naming.map(
        (block) =>
          `${block} names Slack accounts, but the gateway's could not be read (${reason}); not checked here, the job checks them when it runs`,
      ),
    };
  }
  const accounts = () => known;
  return {
    errors: [
      meta === undefined ? undefined : slackAccountsProblem(meta, accounts),
      review === undefined
        ? undefined
        : skillReviewAccountProblem(review, accounts),
    ].filter((p) => p !== undefined),
    warnings: [],
  };
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
 * Validate the instance config: schema (including the secret-literal
 * guard), silo references and the gateway Slack accounts
 * `slack.channelMeta` and `skillReview` name. Never throws; failures are collected in
 * `errors`.
 *
 * @param options - Where the config is.
 * @param deps - What it reads besides the config.
 */
export const configCheck = (
  options: LoadConfigOptions = {},
  deps: ConfigCheckDeps = {},
): ConfigCheckResult => {
  resetConfig();
  try {
    loadConfig(options);
  } catch (e) {
    return {
      ok: false,
      ...located(locate(options)),
      errors: [e instanceof Error ? e.message : String(e)],
      warnings: [],
    };
  }
  const slack = checkSlackAccounts(options, deps);
  const errors = [...checkSilos(options), ...slack.errors];
  return {
    ok: errors.length === 0,
    ...located(locate(options)),
    configPath: getLoadedConfigPath() ?? undefined,
    errors,
    warnings: slack.warnings,
  };
};
