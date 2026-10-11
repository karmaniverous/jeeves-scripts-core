/**
 * Tests for meeting candidate discovery (extract-candidates) and the
 * unfetched-transcript scan (doc-fetch-scan) against temp directories.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ base: '' }));

vi.mock('../../config/index.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getEmailBaseForAccount: () => mocks.base,
}));

const { loadArchiveMessage, scanCache } =
  await import('./extract-candidates.js');
const { findUnfetchedMeetings, loadIndexIfExists } =
  await import('./doc-fetch-scan.js');

beforeEach(() => {
  mocks.base = fs.mkdtempSync(path.join(os.tmpdir(), 'meet-'));
});

afterEach(() => {
  fs.rmSync(mocks.base, { recursive: true, force: true });
});

const write = (rel: string, content: unknown) => {
  const file = path.join(mocks.base, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof content === 'string' ? content : JSON.stringify(content),
  );
};

describe('scanCache', () => {
  it('keeps meeting-like messages from threads/, then threads only in the legacy cache', () => {
    write('threads/a@x/t1/thread.json', {
      threadId: 't1',
      subject: 'Meeting notes: weekly',
      messages: {
        m1: {
          from: 'gemini',
          snippet: 's',
          date: 'd',
          internalDateMs: 5,
          labels: ['INBOX'],
        },
      },
    });
    write('threads/a@x/t2/thread.json', {
      threadId: 't2',
      subject: 'Lunch?',
      messages: { m2: { from: 'bob' } },
    });
    // t1 again in the legacy cache: ignored; t3 only there: scanned.
    write('cache/a@x/t1.json', {
      threadId: 't1',
      subject: 'Meeting notes: weekly',
      messages: { m1: {} },
    });
    write('cache/a@x/t3.json', {
      threadId: 't3',
      subject: 'Meeting recap',
      messages: { m3: {} },
    });

    expect(scanCache('a@x')).toEqual([
      {
        account: 'a@x',
        threadId: 't1',
        messageId: 'm1',
        subject: 'Meeting notes: weekly',
        from: 'gemini',
        snippet: 's',
        date: 'd',
        internalDateMs: 5,
        labels: ['INBOX'],
      },
      {
        account: 'a@x',
        threadId: 't3',
        messageId: 'm3',
        subject: 'Meeting recap',
        from: '',
        snippet: '',
        date: null,
        internalDateMs: null,
        labels: [],
      },
    ]);
  });

  it('keeps a message whose archived body links a Fathom recording', () => {
    write('threads/a@x/t4/thread.json', {
      threadId: 't4',
      subject: 'fyi',
      messages: { m4: {} },
    });
    write('threads/a@x/t4/m4.json', {
      body: { text: 'Watch: https://fathom.video/share/abc123' },
    });
    expect(scanCache('a@x').map((c) => c.messageId)).toEqual(['m4']);
  });

  it('is empty when the account has no cache', () => {
    expect(scanCache('nobody@x')).toEqual([]);
  });
});

describe('loadArchiveMessage', () => {
  it('reads threads/ first, then the legacy archive by message or thread id', () => {
    write('threads/a@x/t1/m1.json', { body: { text: 'new' } });
    write('archive/a@x/t1/m1.json', { body: { text: 'old' } });
    write('archive/a@x/t2/t2.json', { body: { html: '<p>thread</p>' } });
    expect(loadArchiveMessage('a@x', 't1', 'm1')).toEqual({
      body: { text: 'new' },
    });
    expect(loadArchiveMessage('a@x', 't2', 'mX')).toEqual({
      body: { html: '<p>thread</p>' },
    });
    expect(loadArchiveMessage('a@x', 't9', 'm9')).toBeNull();
  });
});

describe('doc-fetch-scan', () => {
  it('finds meetings with a Gemini link and no transcript', () => {
    const dir = path.join(mocks.base, 'meetings');
    write(
      'meetings/m1/gemini_link.txt',
      ' https://docs.google.com/document/d/DOC_1/edit \n',
    );
    write('meetings/m1/meeting.json', { sources: [{ account: 'a@x' }] });
    write(
      'meetings/m2/gemini_link.txt',
      'https://docs.google.com/document/d/DOC_2',
    );
    write('meetings/m2/transcript.txt', 'done');
    write('meetings/m3/notes.txt', 'no link');
    expect(
      findUnfetchedMeetings([dir, path.join(mocks.base, 'missing')]),
    ).toEqual([
      {
        meetingId: 'm1',
        path: path.join(dir, 'm1'),
        link: 'https://docs.google.com/document/d/DOC_1/edit',
        docId: 'DOC_1',
        account: 'a@x',
        manifestPath: path.join(dir, 'm1', 'meeting.json'),
        meetingsDir: dir,
      },
    ]);
  });

  it('loads the meetings index only when it exists', () => {
    const dir = path.join(mocks.base, 'meetings');
    expect(loadIndexIfExists(dir)).toBeNull();
    write('meetings/index.json', {
      meetings: { m1: { hasTranscript: true } },
      updatedAt: 'u',
    });
    expect(loadIndexIfExists(dir)).toEqual({
      meetingsDir: dir,
      indexPath: path.join(dir, 'index.json'),
      index: { meetings: { m1: { hasTranscript: true } }, updatedAt: 'u' },
      dirty: false,
    });
  });
});
