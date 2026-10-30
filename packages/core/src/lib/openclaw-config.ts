/**
 * @module lib/openclaw-config
 *
 * Read the local OpenClaw config: the gateway port and bearer token and
 * the Slack bot tokens. Searches `~/.openclaw/openclaw.json`, then
 * the legacy `~/.clawdbot/clawdbot.json` (home: `USERPROFILE`, else the
 * OS home dir). Files are JSON5, as OpenClaw reads them. Only the fields
 * read here are validated (Zod 4); the rest of the file passes through.
 * Reads files; never logs a token.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getErrorMessage } from '@karmaniverous/jeeves';
import JSON5 from 'json5';
import { z } from 'zod';

import { isEnoent } from './fs-errors.js';

/**
 * A credential as OpenClaw accepts it: a string, possibly holding env
 * references, or a SecretRef object (`{ source, provider, id }`). Any
 * object counts as a SecretRef, so a new OpenClaw source never makes the
 * config invalid (#61 reviews).
 */
const secretInputSchema = z.union([z.string().min(1), z.looseObject({})]);

/** OpenClaw's env reference names (`[A-Z_][A-Z0-9_]*`). */
const ENV_REF = /\$\$\{[A-Z_][A-Z0-9_]*\}|\$\{([A-Z_][A-Z0-9_]*)\}/g;
const BARE_ENV_REF = /^\$([A-Z_][A-Z0-9_]*)$/;

/**
 * The plain value of a credential, resolved as OpenClaw does: `${VAR}`
 * anywhere in the string, or a whole-string `$VAR`, from the environment;
 * `$${VAR}` is a literal `${VAR}`. `undefined` when unset, a SecretRef
 * (core doesn't resolve those) or a reference to a missing or empty
 * variable (OpenClaw leaves those unresolved).
 */
const resolveCredential = (
  value: unknown,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined => {
  if (typeof value !== 'string' || value === '') return undefined;
  const nonEmpty = (name: string): string | undefined => {
    const v = env[name];
    return v === undefined || v === '' ? undefined : v;
  };
  const bare = BARE_ENV_REF.exec(value);
  if (bare) return nonEmpty(bare[1] ?? '');
  const missing: string[] = [];
  const out = value.replace(ENV_REF, (match: string, name?: string) => {
    if (name === undefined) return match.slice(1);
    const v = nonEmpty(name);
    if (v === undefined) missing.push(name);
    return v ?? '';
  });
  return missing.length > 0 ? undefined : out;
};

/** A Slack account block: `channels.slack` or `channels.slack.accounts.<id>`. */
const slackAccountSchema = z.looseObject({
  /** The account's Slack bot token (`xoxb-...`), or a SecretRef. */
  botToken: secretInputSchema.optional(),
});

/** The parts of `openclaw.json` core reads. */
export const openclawConfigSchema = z.looseObject({
  /** Gateway settings. */
  gateway: z
    .looseObject({
      /** Gateway auth. */
      auth: z
        .looseObject({
          /** Bearer token for the gateway HTTP API, or a SecretRef. */
          token: secretInputSchema.optional(),
        })
        .optional(),
      /** Port the gateway listens on. */
      port: z.number().int().min(1).max(65535).optional(),
    })
    .optional(),
  /** Channel settings. */
  channels: z
    .looseObject({
      /** Slack: a flat `botToken` and/or per-account `accounts.<id>.botToken`. */
      slack: slackAccountSchema
        .extend({
          /** Gateway Slack accounts by id. */
          accounts: z.record(z.string(), slackAccountSchema).optional(),
        })
        .optional(),
    })
    .optional(),
});

/** Validated view of `openclaw.json`. */
export type OpenclawConfig = z.infer<typeof openclawConfigSchema>;

/** OpenClaw's state directories, current first: `~/.openclaw`, then the legacy `~/.clawdbot`. */
export const openclawStateDirs = (
  home: string = process.env.USERPROFILE ?? os.homedir(),
): [string, string] => [
  path.join(home, '.openclaw'),
  path.join(home, '.clawdbot'),
];

/** Candidate config files, in search order. */
export const openclawConfigPaths = (home?: string): string[] => {
  const [current, legacy] = openclawStateDirs(home);
  return [
    path.join(current, 'openclaw.json'),
    path.join(legacy, 'clawdbot.json'),
  ];
};

/**
 * Read and validate one config file; `undefined` when it does not exist.
 *
 * @throws When the file exists but can't be read, isn't JSON5 or fails
 *   {@link openclawConfigSchema}, naming the file and the cause (#42).
 */
const readOpenclawConfig = (file: string): OpenclawConfig | undefined => {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (isEnoent(e)) return undefined;
    throw new Error(
      `Cannot read OpenClaw config ${file}: ${getErrorMessage(e)}`,
      { cause: e },
    );
  }
  let raw: unknown;
  try {
    raw = JSON5.parse(text);
  } catch (e) {
    throw new Error(
      `Invalid JSON5 in OpenClaw config ${file}: ${getErrorMessage(e)}`,
      { cause: e },
    );
  }
  const parsed = openclawConfigSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      `Invalid OpenClaw config ${file}: ${z.prettifyError(parsed.error)}`,
    );
  return parsed.data;
};

/**
 * The first defined value `pick` returns across the config files, in
 * search order. A missing file is skipped.
 *
 * @throws When a file exists but can't be read, isn't JSON5 or is invalid.
 */
export const findInOpenclawConfig = <T>(
  pick: (config: OpenclawConfig) => T | undefined,
  files: readonly string[] = openclawConfigPaths(),
): T | undefined => {
  for (const file of files) {
    const config = readOpenclawConfig(file);
    if (!config) continue;
    const value = pick(config);
    if (value !== undefined) return value;
  }
  return undefined;
};

/** Every plain-string Slack bot token by account id (`channels.slack.accounts`, else the flat `channels.slack.botToken` as `default`). */
const slackBotTokensOf = (config: OpenclawConfig): Record<string, string> => {
  const slack = config.channels?.slack;
  const tokens: Record<string, string> = {};
  for (const [id, account] of Object.entries(slack?.accounts ?? {})) {
    const token = resolveCredential(account.botToken);
    if (token) tokens[id] = token;
  }
  const flat = resolveCredential(slack?.botToken);
  if (Object.keys(tokens).length === 0 && flat) tokens.default = flat;
  return tokens;
};

/**
 * Every Slack bot token by account id, from the first config file that
 * has any.
 *
 * @throws When no config file holds a Slack bot token.
 */
export const slackBotTokens = (
  files: readonly string[] = openclawConfigPaths(),
): Record<string, string> => {
  const tokens = findInOpenclawConfig((config) => {
    const found = slackBotTokensOf(config);
    return Object.keys(found).length ? found : undefined;
  }, files);
  if (!tokens)
    throw new Error(
      `No Slack bot token found in OpenClaw config (searched ${files.join(', ')}); core reads plain tokens and env references (\${VAR}), not SecretRef objects`,
    );
  return tokens;
};

/**
 * The Slack bot token for one gateway Slack account.
 *
 * @param accountId - Account id under `channels.slack.accounts`. Default:
 *   `default` (which also matches the flat `channels.slack.botToken`).
 * @throws When that account has no token.
 */
export const slackBotToken = (
  accountId = 'default',
  files: readonly string[] = openclawConfigPaths(),
): string => {
  const token = slackBotTokens(files)[accountId];
  if (!token)
    throw new Error(
      `No Slack bot token for account "${accountId}" in OpenClaw config`,
    );
  return token;
};

/** The gateway bearer token: a non-empty `CLAWDBOT_GATEWAY_TOKEN`, else a plain-string `gateway.auth.token`; `null` when neither exists (a SecretRef counts as unset). */
export const gatewayToken = (
  files: readonly string[] = openclawConfigPaths(),
): string | null => {
  const fromEnv = process.env.CLAWDBOT_GATEWAY_TOKEN;
  if (fromEnv) return fromEnv;
  return (
    findInOpenclawConfig(
      (config) => resolveCredential(config.gateway?.auth?.token),
      files,
    ) ?? null
  );
};

/** OpenClaw's default gateway port, used when `gateway.port` is unset. */
export const OPENCLAW_DEFAULT_GATEWAY_PORT = 18789;

/** The gateway's port: `gateway.port` from the OpenClaw config, else OpenClaw's default (18789). */
export const gatewayPort = (
  files: readonly string[] = openclawConfigPaths(),
): number =>
  findInOpenclawConfig((config) => config.gateway?.port, files) ??
  OPENCLAW_DEFAULT_GATEWAY_PORT;
