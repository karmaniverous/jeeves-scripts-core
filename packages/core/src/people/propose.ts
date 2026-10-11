/**
 * @module people/propose
 *
 * `jeeves-scripts people propose` (Decision 34): read the users of every
 * Slack workspace the gateway's bots belong to (`users.list`, read-only),
 * group users across workspaces by email (case-insensitive) and by real
 * name, and print a proposed `people` block with the matches that need a
 * human look. It never writes config: the operator confirms the proposal
 * and copies what is right into `jeeves-scripts.json`.
 */

import type { People } from '../config/people-schema.js';
import { slackBotTokens } from '../lib/openclaw-config.js';
import { fetchUsers, type SlackApiUser } from '../slack/lib/slack-api.js';

/** One Slack user in one workspace. */
export interface SeedUser {
  /** Gateway Slack account (`default`, `work`, ...). */
  account: string;
  id: string;
  handle: string;
  realName?: string;
  email?: string;
}

/** A proposed grouping that needs a human look. */
export interface UncertainMatch {
  reason: string;
  personId?: string;
  users: SeedUser[];
}

/** The proposal printed by `people propose`. */
export interface PeopleProposal {
  summary: {
    accounts: Record<string, number>;
    usersRead: number;
    proposedPeople: number;
    multiAccountPeople: number;
    uncertain: number;
  };
  people: People;
  uncertain: UncertainMatch[];
}

/** Real people only: no bots, no deactivated users, no Slackbot. */
export const isHuman = (u: SlackApiUser): boolean =>
  !u.deleted && !u.is_bot && u.id !== 'USLACKBOT';

/** The seed record for a `users.list` member. */
export function seedUser(account: string, u: SlackApiUser): SeedUser {
  const realName = [u.profile?.real_name, u.real_name]
    .map((n) => n?.trim())
    .find(Boolean);
  const email = u.profile?.email?.trim().toLowerCase();
  return {
    account,
    id: u.id,
    handle: u.name ?? u.id,
    ...(realName ? { realName } : {}),
    ...(email ? { email } : {}),
  };
}

/** A real name normalised for matching: no accents, lowercase, single spaces. */
export const nameKey = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** A person id slug from a name. */
export const slugOf = (name: string): string =>
  nameKey(name).replace(/\s+/g, '-') || 'person';

/**
 * Group users into proposed people.
 *
 * - Users sharing an email (any workspace) are one person.
 * - Users in different workspaces sharing a real name are one person, but
 *   a name-only link is listed as uncertain.
 * - A real name shared by two users of the same workspace links nobody
 *   (listed as uncertain).
 * - Only people with more than one account are proposed unless `all`.
 */
export function proposePeople(
  users: readonly SeedUser[],
  options: { all?: boolean } = {},
): PeopleProposal {
  // Union-find over user indexes.
  const parent = users.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] ?? r;
    return r;
  };
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };

  const byEmail = new Map<string, number[]>();
  const byName = new Map<string, number[]>();
  users.forEach((u, i) => {
    if (u.email) byEmail.set(u.email, [...(byEmail.get(u.email) ?? []), i]);
    if (u.realName) {
      const k = nameKey(u.realName);
      if (k) byName.set(k, [...(byName.get(k) ?? []), i]);
    }
  });
  for (const ix of byEmail.values())
    for (const i of ix.slice(1)) union(ix[0] ?? i, i);

  const uncertain: UncertainMatch[] = [];
  const nameOnly = new Set<number>(); // roots merged by name alone
  for (const [key, ix] of byName) {
    const accounts = ix.map((i) => users[i]?.account);
    if (new Set(accounts).size !== accounts.length) {
      if (ix.length > 1 && new Set(accounts).size > 1)
        uncertain.push({
          reason: `real name "${key}" is shared by more than one user in a workspace; not grouped by name`,
          users: ix.map((i) => users[i]).filter((u) => u !== undefined),
        });
      continue;
    }
    for (const i of ix.slice(1)) {
      const a = ix[0] ?? i;
      if (find(a) !== find(i)) {
        union(a, i);
        nameOnly.add(i);
        nameOnly.add(a);
      }
    }
  }

  const groups = new Map<number, number[]>();
  users.forEach((_, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });

  const people: People = {};
  let multiAccount = 0;
  for (const ix of groups.values()) {
    const members = ix.map((i) => users[i]).filter((u) => u !== undefined);
    const accounts = new Set(members.map((m) => `${m.account}/${m.id}`));
    const multi = new Set(members.map((m) => m.account)).size > 1;
    if (multi) multiAccount++;
    if (accounts.size < 2 && !options.all) continue;

    const name =
      members.map((m) => m.realName).find(Boolean) ??
      members[0]?.handle ??
      'unknown';
    let id = slugOf(name);
    for (let n = 2; Object.hasOwn(people, id); n++)
      id = `${slugOf(name)}-${String(n)}`;
    const emails = [
      ...new Set(members.map((m) => m.email).filter((e) => e !== undefined)),
    ];
    people[id] = {
      name,
      ...(emails.length ? { emails } : {}),
      accounts: members.map((m) => ({
        channel: 'slack',
        account: m.account,
        id: m.id,
      })),
    };

    const sameAccountTwice =
      new Set(members.map((m) => m.account)).size < members.length;
    if (ix.some((i) => nameOnly.has(i)))
      uncertain.push({
        reason:
          'grouped by real name only (no shared email); confirm these are one person',
        personId: id,
        users: members,
      });
    else if (sameAccountTwice)
      uncertain.push({
        reason:
          'one email on several users of the same workspace (duplicate or shared mailbox?)',
        personId: id,
        users: members,
      });
  }

  const perAccount: Record<string, number> = {};
  for (const u of users)
    perAccount[u.account] = (perAccount[u.account] ?? 0) + 1;
  return {
    summary: {
      accounts: perAccount,
      usersRead: users.length,
      proposedPeople: Object.keys(people).length,
      multiAccountPeople: multiAccount,
      uncertain: uncertain.length,
    },
    people,
    uncertain,
  };
}

/** Read every bot account's users from Slack (read-only) and propose people. */
export async function proposeFromSlack(
  options: {
    all?: boolean;
    tokens?: Record<string, string>;
    list?: (token: string) => Promise<SlackApiUser[]>;
  } = {},
): Promise<PeopleProposal> {
  const tokens = options.tokens ?? slackBotTokens();
  const list = options.list ?? fetchUsers;
  const users: SeedUser[] = [];
  for (const [account, token] of Object.entries(tokens))
    for (const u of await list(token))
      if (isHuman(u)) users.push(seedUser(account, u));
  return proposePeople(users, { all: options.all });
}
