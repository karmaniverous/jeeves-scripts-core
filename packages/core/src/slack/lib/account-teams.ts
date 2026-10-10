/**
 * @module slack/lib/account-teams
 *
 * Which Slack workspace (team id) each gateway Slack account's bot
 * belongs to: Slack `auth.test` with that account's bot token, cached in
 * `{stateDir}/slack/accounts.json` (a Slack fact, so state). The default
 * account's workspace is the instance's primary workspace; it replaces
 * the old `integrations.slack.primaryWorkspace` setting (Decision 9).
 * A bot token never changes workspace, so cached answers are kept; delete
 * the file to re-read them.
 */

import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { slackApi } from './slack-api.js';
import { slackCacheDir } from './slack-cache.js';

/** The workspace (team) id a bot token belongs to (`auth.test`); throws when Slack returns none. */
export async function getTeamId(token: string): Promise<string> {
  const resp = await slackApi('auth.test', {}, token);
  if (!resp.team_id || typeof resp.team_id !== 'string') {
    throw new Error(
      `auth.test did not return a valid team_id (got ${JSON.stringify(resp.team_id)})`,
    );
  }
  return resp.team_id;
}

const accountTeamsSchema = z.record(z.string(), z.string());

/** `{stateDir}/slack/accounts.json`. */
export const accountTeamsFile = (): string =>
  path.join(slackCacheDir(), 'accounts.json');

/** The cached account → team map (`{}` when missing or unreadable). */
export function loadAccountTeams(
  file: string = accountTeamsFile(),
): Record<string, string> {
  try {
    return accountTeamsSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return {};
  }
}

/**
 * The team of every account in `tokensByAccount`: cached, else
 * `auth.test` (then cached). An account whose `auth.test` fails is left
 * out and logged; its channels fall back as described in
 * channel-workspace.
 */
export async function accountTeams(
  tokensByAccount: Record<string, string>,
  file: string = accountTeamsFile(),
  teamOf: (token: string) => Promise<string> = getTeamId,
): Promise<Record<string, string>> {
  const cached = loadAccountTeams(file);
  const teams: Record<string, string> = {};
  let changed = false;
  for (const [account, token] of Object.entries(tokensByAccount)) {
    const known = cached[account];
    if (known) {
      teams[account] = known;
      continue;
    }
    try {
      teams[account] = await teamOf(token);
      cached[account] = teams[account];
      changed = true;
    } catch (err) {
      console.error(
        `auth.test failed for Slack account "${account}" (skipping): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (changed) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(cached, null, 2)}\n`);
  }
  return teams;
}

/** The primary workspace: the `default` account's team, else the first account's, else `''`. */
export const primaryTeam = (teams: Record<string, string>): string =>
  teams.default ?? Object.values(teams)[0] ?? '';

/** Team id → account, for the accounts in `teams`. */
export const teamToAccount = (
  teams: Record<string, string>,
): Record<string, string> =>
  Object.fromEntries(Object.entries(teams).map(([a, t]) => [t, a]));
