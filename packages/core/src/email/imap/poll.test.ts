/**
 * Tests for the IMAP account poller with a fake connection: password
 * resolution, auth failure, first-run tail fetch, watermarks, uidValidity
 * reset, dedup and per-message failures. Messages land in a temp archive
 * (`useTempConfig`).
 */

import fs from 'node:fs';
import path from 'node:path';

import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountConfig, ImapPassword } from '../../config/index.js';
import { imapSecretPath } from '../../config/index.js';
import { fakeRunnerClient } from '../../lib/fake-runner-client.test-helper.js';
import { useTempConfig } from '../../lib/temp-config.test-helper.js';
import type { ImapConnection, ImapConnector } from './connection.js';
import { pollImapAccount } from './poll.js';

const SECRET = 'correct horse';
const baseDir = useTempConfig();

function account(password: ImapPassword, folders?: string[]): AccountConfig {
  return {
    email: 'carol@example.com',
    type: 'imap',
    emailPolling: true,
    imap: {
      host: 'imap.example.com',
      port: 993,
      tls: true,
      user: 'carol@example.com',
      password,
    },
    ...(folders ? { folders } : {}),
  };
}

const rfc822 = (id: string, subject: string) =>
  Buffer.from(
    [
      `Message-ID: <${id}@example.com>`,
      'From: Dan <dan@example.com>',
      'To: carol@example.com',
      `Subject: ${subject}`,
      'Date: Mon, 2 Mar 2026 10:00:00 +0000',
      '',
      `Body of ${subject}`,
    ].join('\r\n'),
  );

interface FakeMessage {
  uid: number;
  source?: Buffer;
  flags?: Set<string>;
}

/** A connection over one mailbox state per folder. */
function fakeConnection(
  boxes: Record<
    string,
    { uidValidity: number; exists: number; messages: FakeMessage[] }
  >,
  over: Partial<Record<'connect', () => Promise<void>>> = {},
) {
  const ranges: string[] = [];
  let current = '';
  const conn = {
    connect: over.connect ?? (() => Promise.resolve()),
    logout: vi.fn(() => Promise.resolve()),
    list: () => Promise.resolve(Object.keys(boxes).map((p) => ({ path: p }))),
    getMailboxLock: (folder: string) => {
      if (!(folder in boxes))
        return Promise.reject(new Error(`no folder ${folder}`));
      current = folder;
      return Promise.resolve({ path: folder, release: () => undefined });
    },
    get mailbox() {
      return boxes[current];
    },
    fetchAll: (range: string) => {
      ranges.push(`${current} ${range}`);
      const [from] = range.split(':');
      const box = boxes[current];
      return Promise.resolve(
        (box?.messages ?? [])
          .filter((m) => m.uid >= Number(from))
          .map((m) => ({
            flags: new Set<string>(),
            internalDate: new Date('2026-03-02T10:00:00Z'),
            ...m,
          })),
      );
    },
  };
  const options: unknown[] = [];
  const connector: ImapConnector = (imap, pass) => {
    options.push({ ...imap, pass });
    return conn as unknown as ImapConnection;
  };
  return { conn, connector, ranges, options };
}

let error: MockInstance<typeof console.error>;
let runner: ReturnType<typeof fakeRunnerClient>;

beforeEach(() => {
  // Load the temp config before any test stubs fs, and give carol a secret.
  const secret = imapSecretPath('carol');
  fs.mkdirSync(path.dirname(secret), { recursive: true });
  fs.writeFileSync(secret, `${SECRET}\n`);
  runner = fakeRunnerClient();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('pollImapAccount password resolution', () => {
  it('authenticates with the secretRef file content, trimmed, and logs an auth failure without it', async () => {
    const read = vi.spyOn(fs, 'readFileSync');
    const { connector, options } = fakeConnection(
      {},
      {
        connect: () => Promise.reject(new Error('AUTHENTICATIONFAILED login')),
      },
    );
    const stats = await pollImapAccount(
      account({ secretRef: 'carol' }),
      runner.client,
      connector,
    );
    expect(read).toHaveBeenCalledWith(imapSecretPath('carol'), 'utf8');
    expect(options).toEqual([
      expect.objectContaining({ user: 'carol@example.com', pass: SECRET }),
    ]);
    expect(stats.folders).toBe(0);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).not.toContain(SECRET);
  });

  it('fails before connecting when the secret file is missing', async () => {
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw Object.assign(new Error('nope'), { code: 'ENOENT' });
    });
    const { connector, options } = fakeConnection({});
    await expect(
      pollImapAccount(
        account({ secretRef: 'carol' }),
        runner.client,
        connector,
      ),
    ).rejects.toThrow(
      `IMAP secret "carol" could not be read from ${imapSecretPath('carol')} (ENOENT).`,
    );
    expect(options).toEqual([]);
  });

  it('rethrows a connect failure that is not an auth failure', async () => {
    const { connector } = fakeConnection(
      {},
      { connect: () => Promise.reject(new Error('ECONNREFUSED')) },
    );
    await expect(
      pollImapAccount(
        account({ secretRef: 'carol' }),
        runner.client,
        connector,
      ),
    ).rejects.toThrow('ECONNREFUSED');
  });
});

describe('pollImapAccount', () => {
  it('returns empty totals for an account without imap', async () => {
    const { imap: _imap, ...gmail } = account({ secretRef: 'carol' });
    await expect(
      pollImapAccount({ ...gmail, type: 'gmail' }, runner.client),
    ).resolves.toEqual({
      fetched: 0,
      written: 0,
      skipped: 0,
      failed: 0,
      folders: 0,
    });
  });

  it('writes new messages, keeps watermarks, skips known ones and counts failures', async () => {
    const boxes = {
      INBOX: {
        uidValidity: 7,
        exists: 3,
        messages: [
          { uid: 1, source: rfc822('a', 'Hello') },
          { uid: 2 },
          { uid: 3, source: Buffer.from('') },
        ],
      },
    };
    const f = fakeConnection(boxes);
    f.conn.list = () =>
      Promise.resolve([{ path: 'INBOX' }, { path: 'Broken' }]);
    const stats = await pollImapAccount(
      account({ secretRef: 'carol' }),
      runner.client,
      f.connector,
    );
    expect(stats).toMatchObject({
      fetched: 3,
      written: 2,
      failed: 1,
      folders: 1,
    });
    expect(error).toHaveBeenCalledWith(
      '[imap] Folder "Broken" error: no folder Broken',
    );
    const threads = path.join(baseDir(), 'content');
    expect(fs.existsSync(threads)).toBe(true);
    expect(
      JSON.parse(
        runner.client.getState('imap-poll', 'carol@example.com') ?? '{}',
      ),
    ).toMatchObject({
      folders: { INBOX: { uidValidity: 7, lastUid: 3 } },
    });

    const again = await pollImapAccount(
      account({ secretRef: 'carol' }, ['INBOX']),
      runner.client,
      f.connector,
    );
    expect(again).toMatchObject({ fetched: 0, written: 0 });
    expect(f.conn.logout).toHaveBeenCalledTimes(2);
  });

  it('fetches only the tail on a first run and resets the watermark when uidValidity changes', async () => {
    const messages = Array.from({ length: 101 }, (_, i) => ({
      uid: i + 1,
      source: rfc822(`m${String(i)}`, `S${String(i)}`),
    }));
    const boxes = { INBOX: { uidValidity: 1, exists: 101, messages } };
    const f = fakeConnection(boxes);
    await pollImapAccount(
      account({ secretRef: 'carol' }, ['INBOX']),
      runner.client,
      f.connector,
    );
    expect(f.ranges[0]).toBe('INBOX 2:*');
    boxes.INBOX.uidValidity = 2;
    boxes.INBOX.messages = [{ uid: 1, source: rfc822('new', 'New') }];
    boxes.INBOX.exists = 1;
    const stats = await pollImapAccount(
      account({ secretRef: 'carol' }, ['INBOX']),
      runner.client,
      f.connector,
    );
    expect(f.ranges[1]).toBe('INBOX 1:*');
    expect(stats.written).toBe(1);
  });
});
