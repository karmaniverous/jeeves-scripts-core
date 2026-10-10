/**
 * The `people` registry at each caller (Decision 34): Slack message
 * authors, DM names, meeting packages, email (Gmail events, IMAP message
 * files) and calendar events. Listed people get their configured name
 * and id; unlisted ones are recorded exactly as before.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { RunnerClient } from '@karmaniverous/jeeves-runner';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  appendJsonl: vi.fn(),
  gogWithRetry: vi.fn(),
  threadsDir: '',
  meetingsDir: '',
}));

vi.mock('@karmaniverous/jeeves', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appendJsonl: mocks.appendJsonl,
}));
vi.mock('./gog.js', () => ({ gogWithRetry: mocks.gogWithRetry }));
vi.mock('../email/email-cache.js', () => ({
  createOrUpdateCache: vi.fn(),
  detectLabelChanges: vi.fn(() => []),
  loadCache: vi.fn(),
  getThreadsPath: (account: string, threadId: string) =>
    path.join(mocks.threadsDir, account, threadId),
}));
vi.mock('./constants.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConstantsModule>();
  return {
    ...actual,
    constants: () => ({
      ...actual.constants(),
      DEFAULT_MEETINGS_DIR: mocks.meetingsDir,
      EMAIL_EVENTS_DIR: mocks.threadsDir,
    }),
  };
});

import { dmPeopleNames } from '../admin/lib/dm-name-sources.js';
import { resolveDmNames } from '../admin/lib/dm-names.js';
import { eventPeopleField } from '../calendar/lib/calendar-api.js';
import { CONFIG_PATH_ENV, resetConfig } from '../config/loader.js';
import { fetchThreadMetadata } from '../email/google-workspace/email-fetch.js';
import { writeMessage as writeImapMessage } from '../email/imap/message-store.js';
import type { NormalizedMessage } from '../email/imap/normalize.js';
import { updateMeetingPackage } from '../meetings/lib/package.js';
import { writeMessage as writeSlackMessage } from '../slack/lib/message-writer.js';
import type * as ConstantsModule from './constants.js';
import { emailPeopleFields } from './people.js';

const JASON = { id: 'jason-williscroft', name: 'Jason Williscroft' };

let dir: string;
const savedEnv = process.env[CONFIG_PATH_ENV];

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'people-callers-'));
  const base = JSON.parse(fs.readFileSync(savedEnv ?? '', 'utf8')) as Record<
    string,
    unknown
  >;
  const configPath = path.join(dir, 'jeeves-scripts.json');
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      ...base,
      people: {
        'jason-williscroft': {
          name: JASON.name,
          emails: ['jason@johngalt.id', 'jason.williscroft@veterancrowd.com'],
          accounts: [
            { channel: 'slack', account: 'default', id: 'U0AB7J9RCHF' },
            { channel: 'slack', account: 'vc', id: 'U0VCJASON' },
          ],
        },
      },
    }),
  );
  process.env[CONFIG_PATH_ENV] = configPath;
  resetConfig();
});

afterAll(() => {
  process.env[CONFIG_PATH_ENV] = savedEnv;
  resetConfig();
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  mocks.threadsDir = path.join(dir, 'threads');
  mocks.meetingsDir = path.join(dir, 'meetings');
  vi.clearAllMocks();
});

const readJson = (file: string) =>
  JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;

describe('Slack message authors', () => {
  const write = (user: string, account?: string) => {
    const channelDir = path.join(dir, 'slack', `${user}-${account ?? 'none'}`);
    writeSlackMessage(
      channelDir,
      'C1',
      {
        name: 'general',
        type: 'channel',
        ...(account ? { _account: account } : {}),
      },
      { ts: '1700000000.000100', user, text: 'hi' },
      {
        U0AB7J9RCHF: 'jason (slack)',
        U0VCJASON: 'J.W.',
        U0OTHER: 'Other Person',
      },
    );
    return readJson(path.join(channelDir, '1700000000.000100.json'));
  };

  it('names a listed author by person, per account', () => {
    expect(write('U0VCJASON', 'vc')).toMatchObject({
      userName: JASON.name,
      personId: JASON.id,
    });
    // Channels without a recorded account belong to the default account.
    expect(write('U0AB7J9RCHF')).toMatchObject({ personId: JASON.id });
  });

  it('leaves unlisted authors (and listed ids in another account) as before', () => {
    const other = write('U0OTHER', 'vc');
    expect(other.userName).toBe('Other Person');
    expect(other).not.toHaveProperty('personId');
    expect(write('U0VCJASON', 'default')).not.toHaveProperty('personId');
  });
});

describe('DM names', () => {
  it('prefers the configured name, and leaves others to cache and users', async () => {
    const people = dmPeopleNames(['U0AB7J9RCHF', 'U0OTHER']);
    expect(people).toEqual({ U0AB7J9RCHF: JASON.name });
    const { names, learned } = await resolveDmNames(
      ['U0AB7J9RCHF', 'U0OTHER'],
      {
        people,
        cache: { U0AB7J9RCHF: 'stale', U0OTHER: 'Cached Other' },
        userMap: {},
      },
    );
    expect(Object.fromEntries(names)).toEqual({
      U0AB7J9RCHF: JASON.name,
      U0OTHER: 'Cached Other',
    });
    expect(learned).toEqual({});
  });
});

describe('meeting packages', () => {
  const client = { setItem: vi.fn() } as unknown as Pick<
    RunnerClient,
    'setItem'
  >;
  const meeting = (id: string, participants: string[]) => ({
    meetingId: id,
    account: 'no-domain',
    threadId: 't1',
    messageId: 'msg00001',
    subject: 'Weekly',
    normalizedTitle: 'weekly',
    meetingDate: '2026-10-06',
    source: 'gemini',
    from: 'gemini-notes@google.com',
    participants,
    geminiLink: null,
    bodyText: '',
    bodyHtml: '',
    extractedAt: '2026-10-06T00:00:00.000Z',
  });

  it('lists the people among participants, keeping participant emails', () => {
    updateMeetingPackage(
      meeting('m1', ['Jason@JohnGalt.id', 'x@example.com']),
      client,
    );
    const m = readJson(path.join(mocks.meetingsDir, 'm1', 'meeting.json'));
    expect(m.participants).toEqual(['Jason@JohnGalt.id', 'x@example.com']);
    expect(m.people).toEqual([JASON]);
  });

  it('adds nothing when no participant is listed', () => {
    updateMeetingPackage(meeting('m2', ['x@example.com']), client);
    expect(
      readJson(path.join(mocks.meetingsDir, 'm2', 'meeting.json')),
    ).not.toHaveProperty('people');
  });
});

describe('email', () => {
  it('emailPeopleFields names the sender and every listed party', () => {
    expect(
      emailPeopleFields({
        from: 'Jason <JASON@johngalt.id>',
        to: 'a@x.com, jason.williscroft@veterancrowd.com',
      }),
    ).toEqual({ fromPerson: JASON, people: [JASON] });
    expect(
      emailPeopleFields({ from: 'a@x.com', to: 'Jason <jason@johngalt.id>' }),
    ).toEqual({ people: [JASON] });
    expect(emailPeopleFields({ from: 'a@x.com', to: 'b@x.com' })).toEqual({});
  });

  it('records people on Gmail message events', () => {
    mocks.gogWithRetry.mockReturnValue(
      JSON.stringify({
        thread: {
          messages: [
            {
              id: 'm1',
              internalDate: '1000',
              labelIds: ['INBOX'],
              payload: {
                headers: [
                  { name: 'From', value: 'Jason <jason@johngalt.id>' },
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
      }),
    );
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
      reportOnly: true,
    });
    const events = mocks.appendJsonl.mock.calls.map(
      (c) => c[1] as Record<string, unknown>,
    );
    expect(events[0]).toMatchObject({ fromPerson: JASON, people: [JASON] });
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
    writeImapMessage(
      'me@x',
      't1',
      'm1',
      msg('jason.williscroft@veterancrowd.com'),
      [],
    );
    writeImapMessage('me@x', 't1', 'm2', msg('a@x.com'), []);
    const file = (id: string) =>
      readJson(path.join(mocks.threadsDir, 'me@x', 't1', `${id}.json`));
    expect(file('m1')).toMatchObject({ fromPerson: JASON, people: [JASON] });
    expect(file('m2')).not.toHaveProperty('people');
  });
});

describe('calendar events', () => {
  it('lists the people among organizer, creator and attendees', () => {
    expect(
      eventPeopleField({
        id: 'e1',
        organizer: { email: 'Jason@JohnGalt.id' },
        attendees: [{ email: 'a@x.com' }],
      }),
    ).toEqual({ _people: [JASON] });
    expect(
      eventPeopleField({ id: 'e2', attendees: [{ email: 'a@x.com' }] }),
    ).toEqual({});
  });
});
