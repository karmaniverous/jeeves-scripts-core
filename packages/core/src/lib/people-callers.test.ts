/**
 * The `people` registry at each caller (Decision 34): Slack message
 * authors, DM names and meeting packages (email and calendar callers are
 * in people-callers-email.test.ts). Listed people get their configured
 * name and id; unlisted ones are recorded exactly as before.
 */

import path from 'node:path';

import type { RunnerClient } from '@karmaniverous/jeeves-runner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import { updateMeetingPackage } from '../meetings/lib/package.js';
import { writeMessage as writeSlackMessage } from '../slack/lib/message-writer.js';
import type * as ConstantsModule from './constants.js';
import {
  JANE,
  readJson,
  usePeopleConfig,
} from './people-callers.test-helper.js';

const tmp = usePeopleConfig();
let dir: string;

beforeEach(() => {
  dir = tmp();
  mocks.threadsDir = path.join(dir, 'threads');
  mocks.meetingsDir = path.join(dir, 'meetings');
  vi.clearAllMocks();
});

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
        U0JANE0001: 'jane (slack)',
        U0JANE0002: 'J.W.',
        U0OTHER: 'Other Person',
      },
    );
    return readJson(path.join(channelDir, '1700000000.000100.json'));
  };

  it('names a listed author by person, per account', () => {
    expect(write('U0JANE0002', 'work')).toMatchObject({
      userName: JANE.name,
      personId: JANE.id,
    });
    // Channels without a recorded account belong to the default account.
    expect(write('U0JANE0001')).toMatchObject({ personId: JANE.id });
  });

  it('leaves unlisted authors (and listed ids in another account) as before', () => {
    const other = write('U0OTHER', 'work');
    expect(other.userName).toBe('Other Person');
    expect(other).not.toHaveProperty('personId');
    expect(write('U0JANE0002', 'default')).not.toHaveProperty('personId');
  });
});

describe('DM names', () => {
  it('prefers the configured name, and leaves others to cache and users', async () => {
    const people = dmPeopleNames(['U0JANE0001', 'U0OTHER']);
    expect(people).toEqual({ U0JANE0001: JANE.name });
    const { names, learned } = await resolveDmNames(['U0JANE0001', 'U0OTHER'], {
      people,
      cache: { U0JANE0001: 'stale', U0OTHER: 'Cached Other' },
      userMap: {},
    });
    expect(Object.fromEntries(names)).toEqual({
      U0JANE0001: JANE.name,
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
      meeting('m1', ['Jane@Example.com', 'x@example.com']),
      client,
    );
    const m = readJson(path.join(mocks.meetingsDir, 'm1', 'meeting.json'));
    expect(m.participants).toEqual(['Jane@Example.com', 'x@example.com']);
    expect(m.people).toEqual([JANE]);
  });

  it('adds nothing when no participant is listed', () => {
    updateMeetingPackage(meeting('m2', ['x@example.com']), client);
    expect(
      readJson(path.join(mocks.meetingsDir, 'm2', 'meeting.json')),
    ).not.toHaveProperty('people');
  });
});
