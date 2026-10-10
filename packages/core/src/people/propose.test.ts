/**
 * Tests for the read-only people proposal: filtering, email and name
 * grouping, uncertain matches, and that the proposal is a valid `people`
 * block.
 */

import { describe, expect, it, vi } from 'vitest';

import { peopleSchema } from '../config/people-schema.js';
import type { SlackApiUser } from '../slack/lib/slack-api.js';
import {
  isHuman,
  nameKey,
  proposeFromSlack,
  proposePeople,
  type SeedUser,
  seedUser,
  slugOf,
} from './propose.js';

const u = (
  account: string,
  id: string,
  realName?: string,
  email?: string,
): SeedUser => ({
  account,
  id,
  handle: id.toLowerCase(),
  ...(realName ? { realName } : {}),
  ...(email ? { email } : {}),
});

describe('helpers', () => {
  it('keeps only active humans', () => {
    expect(isHuman({ id: 'U1' })).toBe(true);
    expect(isHuman({ id: 'U2', deleted: true })).toBe(false);
    expect(isHuman({ id: 'B1', is_bot: true })).toBe(false);
    expect(isHuman({ id: 'USLACKBOT' })).toBe(false);
  });

  it('reads the real name and lowercases the email', () => {
    expect(
      seedUser('vc', {
        id: 'U1',
        name: 'jw',
        profile: { real_name: ' Jason W ', email: 'J@X.com' },
      }),
    ).toEqual({
      account: 'vc',
      id: 'U1',
      handle: 'jw',
      realName: 'Jason W',
      email: 'j@x.com',
    });
  });

  it('normalises names and slugs', () => {
    expect(nameKey('  José  O\u2019Neil ')).toBe('jose o neil');
    expect(slugOf('José O’Neil')).toBe('jose-o-neil');
    expect(slugOf('!!!')).toBe('person');
  });
});

describe('proposePeople', () => {
  it('groups by email across workspaces, with certainty', () => {
    const p = proposePeople([
      u('default', 'U0AB7J9RCHF', 'Jason Williscroft', 'jason@johngalt.id'),
      u('vc', 'U0VC1', 'Jason Williscroft', 'jason@johngalt.id'),
      u('vc', 'U0VC2', 'Solo Person', 'solo@x.com'),
    ]);
    expect(p.people).toEqual({
      'jason-williscroft': {
        name: 'Jason Williscroft',
        emails: ['jason@johngalt.id'],
        accounts: [
          { channel: 'slack', account: 'default', id: 'U0AB7J9RCHF' },
          { channel: 'slack', account: 'vc', id: 'U0VC1' },
        ],
      },
    });
    expect(p.uncertain).toEqual([]);
    expect(p.summary).toMatchObject({
      usersRead: 3,
      proposedPeople: 1,
      multiAccountPeople: 1,
      accounts: { default: 1, vc: 2 },
    });
    expect(peopleSchema.safeParse(p.people).success).toBe(true);
  });

  it('groups by real name across workspaces, as uncertain', () => {
    const p = proposePeople([
      u('default', 'U1', 'Jason Williscroft', 'jason@johngalt.id'),
      u('vc', 'U2', 'jason  williscroft', 'jason.williscroft@veterancrowd.com'),
    ]);
    expect(p.people['jason-williscroft']?.emails).toEqual([
      'jason@johngalt.id',
      'jason.williscroft@veterancrowd.com',
    ]);
    expect(p.uncertain).toEqual([
      expect.objectContaining({
        personId: 'jason-williscroft',
        reason: expect.stringContaining('real name only') as unknown,
      }),
    ]);
    expect(peopleSchema.safeParse(p.people).success).toBe(true);
  });

  it('does not group by a name two users of one workspace share', () => {
    const p = proposePeople([
      u('default', 'U1', 'Alex Smith'),
      u('default', 'U2', 'Alex Smith'),
      u('vc', 'U3', 'Alex Smith'),
    ]);
    expect(p.people).toEqual({});
    expect(p.uncertain[0]?.reason).toContain('shared by more than one user');
  });

  it('flags one email on two users of the same workspace', () => {
    const p = proposePeople([
      u('vc', 'U1', 'Ops', 'ops@x.com'),
      u('vc', 'U2', 'Ops Two', 'ops@x.com'),
    ]);
    expect(Object.keys(p.people)).toEqual(['ops']);
    expect(p.uncertain[0]?.reason).toContain('same workspace');
    expect(p.summary.multiAccountPeople).toBe(0);
  });

  it('includes single-account people with all, de-duplicating ids', () => {
    const p = proposePeople(
      [
        u('default', 'U1', 'Sam'),
        u('vc', 'U2', 'Sam Two'),
        u('vc', 'U3', 'Sam'),
      ],
      { all: true },
    );
    expect(Object.keys(p.people).sort()).toEqual(['sam', 'sam-two']);
    expect(peopleSchema.safeParse(p.people).success).toBe(true);
  });
});

describe('proposeFromSlack', () => {
  it('reads every account with its token, skipping bots and deactivated users', async () => {
    const lists: Record<string, SlackApiUser[]> = {
      'xoxb-a': [
        {
          id: 'U1',
          name: 'jw',
          profile: { real_name: 'J W', email: 'j@x.com' },
        },
        { id: 'B1', is_bot: true },
      ],
      'xoxb-b': [
        { id: 'U9', name: 'jw2', profile: { email: 'J@X.com' } },
        { id: 'U8', deleted: true, profile: { email: 'j@x.com' } },
      ],
    };
    const list = vi.fn((token: string) => Promise.resolve(lists[token] ?? []));
    const p = await proposeFromSlack({
      tokens: { default: 'xoxb-a', vc: 'xoxb-b' },
      list,
    });
    expect(list).toHaveBeenCalledTimes(2);
    expect(p.summary.usersRead).toBe(2);
    expect(p.people['j-w']?.accounts).toEqual([
      { channel: 'slack', account: 'default', id: 'U1' },
      { channel: 'slack', account: 'vc', id: 'U9' },
    ]);
  });
});
