/**
 * @module lib/people
 *
 * Who someone is (Decision 34): resolve a channel account or an email
 * address to a person in the `people` block of `jeeves-scripts.json`.
 * Unlisted accounts and addresses resolve to `undefined`, and callers
 * keep their channel-derived names for them.
 */

import { loadConfig } from '../config/loader.js';
import {
  accountKey,
  type People,
  type Person,
} from '../config/people-schema.js';

/** A resolved person: their id and their configured record. */
export interface ResolvedPerson extends Person {
  id: string;
}

/** What callers record about a person: id and configured name. */
export interface PersonRef {
  id: string;
  name: string;
}

interface PeopleIndex {
  byAccount: Map<string, ResolvedPerson>;
  /** `channel` + `id` (any account) → people with that id. */
  byChannelId: Map<string, ResolvedPerson[]>;
  byEmail: Map<string, ResolvedPerson>;
}

const indexes = new WeakMap<People, PeopleIndex>();

function indexOf(people: People): PeopleIndex {
  const cached = indexes.get(people);
  if (cached) return cached;
  const index: PeopleIndex = {
    byAccount: new Map(),
    byChannelId: new Map(),
    byEmail: new Map(),
  };
  for (const [id, person] of Object.entries(people)) {
    const resolved: ResolvedPerson = { id, ...person };
    for (const a of person.accounts ?? []) {
      index.byAccount.set(accountKey(a), resolved);
      const k = JSON.stringify([a.channel, a.id]);
      const list = index.byChannelId.get(k) ?? [];
      if (!list.includes(resolved)) list.push(resolved);
      index.byChannelId.set(k, list);
    }
    for (const e of person.emails ?? [])
      index.byEmail.set(e.toLowerCase(), resolved);
  }
  indexes.set(people, index);
  return index;
}

/** The instance's `people` block (`{}` when none). */
export const peopleRegistry = (): People => loadConfig().people;

/** The person who owns `id` on `channel`/`account`, or undefined. */
export const personForAccount = (
  channel: string,
  account: string,
  id: string,
  people: People = peopleRegistry(),
): ResolvedPerson | undefined =>
  indexOf(people).byAccount.get(accountKey({ channel, account, id }));

/**
 * The person who owns `id` on `channel` in any account, when exactly one
 * does. For callers that know the user id but not the account (e.g. a
 * Slack DM key).
 */
export const personForChannelId = (
  channel: string,
  id: string,
  people: People = peopleRegistry(),
): ResolvedPerson | undefined => {
  const list = indexOf(people).byChannelId.get(JSON.stringify([channel, id]));
  return list?.length === 1 ? list[0] : undefined;
};

/** The bare address in `Name <addr>` or `addr`, lowercased. */
export const bareEmail = (address: string): string =>
  (/<([^>]+)>/.exec(address)?.[1] ?? address).trim().toLowerCase();

/** The person who owns `email` (case-insensitive; `Name <addr>` accepted), or undefined. */
export const personForEmail = (
  email: string,
  people: People = peopleRegistry(),
): ResolvedPerson | undefined => indexOf(people).byEmail.get(bareEmail(email));

/** The id and name to record for a person. */
export const personRef = (p: ResolvedPerson): PersonRef => ({
  id: p.id,
  name: p.name,
});

/** The distinct people owning any of `emails`, in first-seen order; unlisted addresses are skipped. */
export function peopleForEmails(
  emails: Iterable<string>,
  people: People = peopleRegistry(),
): PersonRef[] {
  const seen = new Map<string, PersonRef>();
  for (const e of emails) {
    const p = personForEmail(e, people);
    if (p && !seen.has(p.id)) seen.set(p.id, personRef(p));
  }
  return [...seen.values()];
}

/** Split address headers (`From`/`To`/`Cc` values) into single addresses. */
export const splitAddresses = (...headers: (string | undefined)[]): string[] =>
  headers.flatMap((h) =>
    h
      ? h
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean)
      : [],
  );

/**
 * The person fields for an email message: `fromPerson` when the sender
 * is listed, `people` for every listed sender or recipient. Empty when
 * nobody is listed, so unlisted mail is recorded as before.
 */
export function emailPeopleFields(
  headers: { from?: string; to?: string; cc?: string },
  people: People = peopleRegistry(),
): { fromPerson?: PersonRef; people?: PersonRef[] } {
  const sender = headers.from
    ? personForEmail(headers.from, people)
    : undefined;
  const all = peopleForEmails(
    splitAddresses(headers.from, headers.to, headers.cc),
    people,
  );
  return {
    ...(sender ? { fromPerson: personRef(sender) } : {}),
    ...(all.length ? { people: all } : {}),
  };
}
