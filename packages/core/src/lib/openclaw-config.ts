/**
 * @module lib/openclaw-config
 *
 * Read credentials from the local OpenClaw config: the gateway bearer
 * token and Slack bot tokens. Searches `~/.openclaw/openclaw.json`, then
 * the legacy `~/.clawdbot/clawdbot.json` (home: `USERPROFILE`, else the
 * OS home dir). Only the fields read here are validated (Zod 4); the rest
 * of the file passes through. Reads files; never logs a token.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { z } from 'zod';

/** A Slack account block: `channels.slack` or `channels.slack.accounts.<id>`. */
const slackAccountSchema = z.looseObject({
  /** The account's Slack bot token (`xoxb-...`). */
  botToken: z.string().min(1).optional(),
});

/** The parts of `openclaw.json` core reads. */
export const openclawConfigSchema = z.looseObject({
  /** Gateway settings. */
  gateway: z
    .looseObject({
      /** Gateway auth. */
      auth: z
        .looseObject({
          /** Bearer token for the gateway HTTP API. */
          token: z.string().min(1).optional(),
        })
        .optional(),
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

/** Candidate config files, in search order. */
export const openclawConfigPaths = (
  home: string = process.env.USERPROFILE ?? os.homedir(),
): string[] => [
  path.join(home, '.openclaw', 'openclaw.json'),
  path.join(home, '.clawdbot', 'clawdbot.json'),
];

/**
 * The first defined value `pick` returns across the config files, in
 * search order. Missing, unreadable or invalid files are skipped.
 */
export const findInOpenclawConfig = <T>(
  pick: (config: OpenclawConfig) => T | undefined,
  files: readonly string[] = openclawConfigPaths(),
): T | undefined => {
  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const parsed = openclawConfigSchema.safeParse(raw);
    if (!parsed.success) continue;
    const value = pick(parsed.data);
    if (value !== undefined) return value;
  }
  return undefined;
};

/** Every Slack bot token by account id (`channels.slack.accounts`, else the flat `channels.slack.botToken` as `default`). */
export const slackBotTokensOf = (
  config: OpenclawConfig,
): Record<string, string> => {
  const slack = config.channels?.slack;
  const tokens: Record<string, string> = {};
  for (const [id, account] of Object.entries(slack?.accounts ?? {}))
    if (account.botToken) tokens[id] = account.botToken;
  if (Object.keys(tokens).length === 0 && slack?.botToken)
    tokens.default = slack.botToken;
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
      `No Slack bot token found in OpenClaw config (searched ${files.join(', ')})`,
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

/** The gateway bearer token: a non-empty `CLAWDBOT_GATEWAY_TOKEN`, else `gateway.auth.token`; `null` when neither exists. */
export const gatewayToken = (
  files: readonly string[] = openclawConfigPaths(),
): string | null => {
  const fromEnv = process.env.CLAWDBOT_GATEWAY_TOKEN;
  if (fromEnv) return fromEnv;
  return (
    findInOpenclawConfig((config) => config.gateway?.auth?.token, files) ?? null
  );
};
