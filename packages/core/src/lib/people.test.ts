/**
 * Tests for the `people` schema (slugs, uniqueness) and the resolver.
 */

import { describe, expect, it } from 'vitest';

import { type People, peopleSchema } from '../config/people-schema.js';
import {
  bareEmail,
  peopleForEmails,
  peopleRegistry,
  personForAccount,
  personForChannelId,
  personForEmail,
} from './people.js';

const people: People = peopleSchema.parse({
  'jane-doe': {
    name: 'Jane Doe',
    emails: ['jane@example.com', 'Jane.Doe@Example.org'],
    accounts: [
      { channel: 'slack', account: 'default', id: 'U0JANE0001' },
      { channel: 'slack', account: 'vc', id: 'U0JANE0002' },
    ],
  },
  'ann-bee': {
    name: 'Ann Bee',
    accounts: [{ channel: 'slack', account: 'vc', id: 'U0ANN' }],
  },
  shared: {
    name: 'Shared Id',
    accounts: [{ channel: 'slack', account: 'other', id: 'U0JANE0002' }],
  },
});

describe('peopleSchema', () => {
  it('defaults to no people in the loaded config', () => {
    expect(peopleRegistry()).toEqual({});
  });

  it('rejects ids that are not slugs and unknown keys', () => {
    expect(peopleSchema.safeParse({ Jane: { name: 'J' } }).success).toBe(false);
    expect(
      peopleSchema.safeParse({ j: { name: 'J', alias: 'x' } }).success,
    ).toBe(false);
    expect(
      peopleSchema.safeParse({ j: { name: 'J', emails: ['nope'] } }).success,
    ).toBe(false);
  });

  it('rejects an account that belongs to two people', () => {
    const r = peopleSchema.safeParse({
      a: {
        name: 'A',
        accounts: [{ channel: 'slack', account: 'vc', id: 'U1' }],
      },
      b: {
        name: 'B',
        accounts: [{ channel: 'slack', account: 'vc', id: 'U1' }],
      },
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]).toMatchObject({
      message: 'account slack/vc/U1 belongs to both "a" and "b"',
      path: ['b', 'accounts', 0],
    });
  });

  it('rejects an email that belongs to two people, case-insensitively', () => {
    const r = peopleSchema.safeParse({
      a: { name: 'A', emails: ['x@y.com'] },
      b: { name: 'B', emails: ['X@Y.com'] },
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['b', 'emails', 0]);
  });

  it('allows the same user id in different accounts of different people', () => {
    expect(
      peopleSchema.safeParse({
        a: {
          name: 'A',
          accounts: [{ channel: 'slack', account: 'x', id: 'U1' }],
        },
        b: {
          name: 'B',
          accounts: [{ channel: 'slack', account: 'y', id: 'U1' }],
        },
      }).success,
    ).toBe(true);
  });
});

describe('resolver', () => {
  it('resolves an account to its person', () => {
    expect(personForAccount('slack', 'vc', 'U0JANE0002', people)).toMatchObject(
      {
        id: 'jane-doe',
        name: 'Jane Doe',
      },
    );
    expect(
      personForAccount('slack', 'default', 'U0ANN', people),
    ).toBeUndefined();
    expect(personForAccount('telegram', 'vc', 'U0ANN', people)).toBeUndefined();
  });

  it('resolves a channel id across accounts only when unambiguous', () => {
    expect(personForChannelId('slack', 'U0ANN', people)?.id).toBe('ann-bee');
    expect(personForChannelId('slack', 'U0JANE0002', people)).toBeUndefined();
    expect(personForChannelId('slack', 'U404', people)).toBeUndefined();
  });

  it('resolves emails case-insensitively, with or without a display name', () => {
    expect(personForEmail('JANE@example.com', people)?.id).toBe('jane-doe');
    expect(personForEmail('"J D" <jane.doe@example.org>', people)?.id).toBe(
      'jane-doe',
    );
    expect(personForEmail('someone@else.com', people)).toBeUndefined();
    expect(bareEmail(' A <B@C.d> ')).toBe('b@c.d');
  });

  it('lists the distinct people behind a set of addresses', () => {
    expect(
      peopleForEmails(
        ['jane@example.com', 'x@y.z', 'jane.doe@example.org'],
        people,
      ),
    ).toEqual([{ id: 'jane-doe', name: 'Jane Doe' }]);
  });
});
