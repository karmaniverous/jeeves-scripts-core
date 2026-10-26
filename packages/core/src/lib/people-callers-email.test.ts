/**
 * The `people` registry at the email and calendar callers (Decision 34):
 * Gmail message events, IMAP message files and calendar events. Listed
 * people get their configured name and id; unlisted ones are recorded
 * exactly as before.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { eventPeopleField } from '../calendar/lib/calendar-api.js';
import { allReportOnly } from '../config/report-only.test-helper.js';
import { getThreadsPath } from '../email/email-cache.js';
import { fetchThreadMetadata } from '../email/google-workspace/email-fetch.js';
import { writeMessage as writeImapMessage } from '../email/imap/message-store.js';
import type { NormalizedMessage } from '../email/imap/normalize.js';
import { constants } from './constants.js';
import { emailPeopleFields } from './people.js';
import {
  JANE,
  readJson,
  usePeopleConfig,
} from './people-callers.test-helper.js';

// Archive paths route to the temp config's base directory.
usePeopleConfig();

describe('email', () => {
  it('emailPeopleFields names the sender and every listed party', () => {
    expect(
      emailPeopleFields({
        from: 'Jane <JANE@example.com>',
        to: 'a@x.com, jane.doe@example.org',
      }),
    ).toEqual({ fromPerson: JANE, people: [JANE] });
    expect(
      emailPeopleFields({ from: 'a@x.com', to: 'Jane <jane@example.com>' }),
    ).toEqual({ people: [JANE] });
    expect(emailPeopleFields({ from: 'a@x.com', to: 'b@x.com' })).toEqual({});
  });

  it('records people on Gmail message events', () => {
    const reply = JSON.stringify({
      thread: {
        messages: [
          {
            id: 'm1',
            internalDate: '1000',
            labelIds: ['INBOX'],
            payload: {
              headers: [
                { name: 'From', value: 'Jane <jane@example.com>' },
                { name: 'To', value: 'me@example.com' },
              ],
            },
          },
          {
            id: 'm2',
            internalDate: '2000',
            labelIds: ['INBOX'],
            payload: { headers: [{ name: 'From', value: 'a@x.com' }] },
          },
        ],
      },
    });
    fetchThreadMetadata({
      account: 'me@example.com',
      threadId: 't1',
      subject: 'Hi',
      from: '',
      to: '',
      receiptCandidate: false,
      junkCandidate: false,
      bucket: null,
      labels: ['INBOX'],
      query: 'q',
      client: {
        getState: () => null,
        setState: vi.fn(),
        getItem: () => null,
        setItem: vi.fn(),
        enqueue: vi.fn(() => 1),
      },
      reportOnly: allReportOnly,
      gog: () => reply,
    });
    const eventsFile = fs
      .readdirSync(constants().EMAIL_EVENTS_DIR)
      .find((n) => n.endsWith('.jsonl') && !n.startsWith('_'));
    const events = fs
      .readFileSync(
        path.join(constants().EMAIL_EVENTS_DIR, eventsFile ?? ''),
        'utf8',
      )
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(events[0]).toMatchObject({ fromPerson: JANE, people: [JANE] });
    expect(events[1]).not.toHaveProperty('people');
    expect(events[1]).not.toHaveProperty('fromPerson');
  });

  it('records people in IMAP message files', () => {
    const msg = (from: string) =>
      ({
        headers: { subject: 's', from, to: 'me@example.com', cc: '', date: '' },
        internalDate: new Date('2026-10-01T00:00:00Z'),
        computed: { snippet: '' },
        body: { text: '' },
        attachments: [],
      }) as unknown as NormalizedMessage;
    writeImapMessage('me@x', 't1', 'm1', msg('jane.doe@example.org'), []);
    writeImapMessage('me@x', 't1', 'm2', msg('a@x.com'), []);
    const file = (id: string) =>
      readJson(path.join(getThreadsPath('me@x', 't1'), `${id}.json`));
    expect(file('m1')).toMatchObject({ fromPerson: JANE, people: [JANE] });
    expect(file('m2')).not.toHaveProperty('people');
  });
});

describe('calendar events', () => {
  it('lists the people among organizer, creator and attendees', () => {
    expect(
      eventPeopleField({
        id: 'e1',
        organizer: { email: 'Jane@Example.com' },
        attendees: [{ email: 'a@x.com' }],
      }),
    ).toEqual({ _people: [JANE] });
    expect(
      eventPeopleField({ id: 'e2', attendees: [{ email: 'a@x.com' }] }),
    ).toEqual({});
  });
});
