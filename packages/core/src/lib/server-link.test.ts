/**
 * Tests for the report's jeeves-server insider link: access from the
 * server's own config (local API URL from `port`; the insider key from a
 * named machine key, a seed string or `{ key }`, by `@karmaniverous/jeeves`'
 * `computeInsiderKey`), `GET /api/resolve-path` (the request, the server's
 * `publicUrl`, errors), the Slack link and its label, and resolving before
 * the worker (a live run fails, a preview warns and goes on).
 */

import { computeInsiderKey } from '@karmaniverous/jeeves';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readComponentConfig: vi.fn<(name: string, schema: unknown) => unknown>(),
}));

vi.mock('./component-config.js', () => ({
  readComponentConfig: mocks.readComponentConfig,
}));

const {
  linkBeforeWorker,
  liveReportLink,
  NO_LINK,
  readServerAccess,
  reportLinkLabel,
  resolvePublicUrl,
  serverAccessFrom,
  slackLink,
} = await import('./server-link.js');

type Fetch = Parameters<typeof resolvePublicUrl>[0];
type ReportLink = Parameters<typeof linkBeforeWorker>[0]['reportLink'];

/** `computeInsiderKey('seed-a')`: HMAC-SHA256(seed, "insider"), 32 hex. */
const SEED_A_INSIDER = '99cc33756dcb5257d935fec22da2496d';

describe('serverAccessFrom', () => {
  it.each([
    ['a seed string', 'seed-a'],
    ['a { key } entry', { key: 'seed-a' }],
  ])('derives the insider key from %s (Decision 72)', (_case, entry) => {
    expect(
      serverAccessFrom({ port: 1934, keys: { scripts: entry } }, 'scripts'),
    ).toEqual({
      apiUrl: 'http://127.0.0.1:1934',
      insiderKey: SEED_A_INSIDER,
    });
    expect(computeInsiderKey('seed-a')).toBe(SEED_A_INSIDER);
  });

  it.each([
    ['the config is missing', undefined, 'jeeves-server config not found'],
    ['the config has no port', { keys: { scripts: 's' } }, 'has no port'],
    [
      'the key is missing',
      { port: 1, keys: { other: 's' } },
      'jeeves-server config has no machine key "scripts"',
    ],
    ['there are no keys', { port: 1 }, 'has no machine key "scripts"'],
    [
      'the key is empty',
      { port: 1, keys: { scripts: '' } },
      'has no machine key "scripts"',
    ],
  ])('throws when %s', (_case, config, message) => {
    expect(() => serverAccessFrom(config, 'scripts')).toThrow(message);
  });
});

describe('readServerAccess', () => {
  it("reads jeeves-server's own config by component name", () => {
    mocks.readComponentConfig.mockReturnValue({
      port: 1934,
      keys: { scripts: 'seed-a' },
    });
    expect(readServerAccess('scripts')).toEqual({
      apiUrl: 'http://127.0.0.1:1934',
      insiderKey: SEED_A_INSIDER,
    });
    expect(mocks.readComponentConfig).toHaveBeenCalledWith(
      'server',
      expect.anything(),
    );
  });
});

const ACCESS = { apiUrl: 'http://127.0.0.1:1934', insiderKey: 'abc123' };

const answer = (ok: boolean, status: number, body: unknown): Fetch =>
  vi.fn<Fetch>(() =>
    Promise.resolve({
      ok,
      status,
      json: () =>
        body instanceof Error ? Promise.reject(body) : Promise.resolve(body),
    }),
  );

describe('resolvePublicUrl', () => {
  it("asks the server and returns its publicUrl (any host's paths)", async () => {
    const fetchFn = answer(true, 200, {
      browsePath: 'srv/out/a b.md',
      publicUrl: 'https://jeeves.test/browse/srv/out/a%20b.md',
    });
    await expect(
      resolvePublicUrl(fetchFn, ACCESS, '/srv/out/a b.md'),
    ).resolves.toBe('https://jeeves.test/browse/srv/out/a%20b.md');
    expect(fetchFn).toHaveBeenCalledWith(
      'http://127.0.0.1:1934/api/resolve-path?fsPath=%2Fsrv%2Fout%2Fa+b.md&k=abc123',
    );
  });

  it.each([
    [
      'a path outside every root, with the server error',
      answer(false, 404, {
        error: 'Path does not fall under any configured root',
      }),
      'jeeves-server could not resolve J:\\x.md (HTTP 404: Path does not fall under any configured root)',
    ],
    [
      'a refused key, with a non-JSON body',
      answer(false, 403, new Error('not json')),
      'jeeves-server could not resolve J:\\x.md (HTTP 403)',
    ],
    [
      'no publicUrl configured',
      answer(true, 200, { browsePath: 'j/x.md' }),
      'jeeves-server publicUrl is not configured; refusing to post a filesystem path to Slack',
    ],
    [
      'an empty publicUrl',
      answer(true, 200, { publicUrl: '' }),
      'jeeves-server publicUrl is not configured',
    ],
  ])('throws on %s', async (_case, fetchFn, message) => {
    await expect(resolvePublicUrl(fetchFn, ACCESS, 'J:\\x.md')).rejects.toThrow(
      message,
    );
  });
});

describe('slackLink and reportLinkLabel', () => {
  it('builds a Slack mrkdwn link', () => {
    expect(slackLink('https://x/y', 'label')).toBe('<https://x/y|label>');
  });

  it.each([
    'J:\\out\\2026-10-22.md',
    'J:/out/2026-10-22.md',
    '/srv/out/2026-10-22.md',
  ])('labels %s with its date', (file) => {
    expect(reportLinkLabel('Report', file)).toBe('Report \u2014 2026-10-22');
  });
});

describe('liveReportLink', () => {
  it('resolves through the server config and global fetch', async () => {
    mocks.readComponentConfig.mockReturnValue({
      port: 1934,
      keys: { scripts: 'seed-a' },
    });
    const fetchMock = vi.fn(() =>
      Promise.resolve(Response.json({ publicUrl: 'https://p/x' })),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      expect(
        await liveReportLink('Report')('/out/2026-10-22.md', 'scripts'),
      ).toBe('<https://p/x|Report \u2014 2026-10-22>');
      expect(fetchMock).toHaveBeenCalledWith(
        `http://127.0.0.1:1934/api/resolve-path?fsPath=%2Fout%2F2026-10-22.md&k=${SEED_A_INSIDER}`,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('linkBeforeWorker', () => {
  const request = (reportLink: ReportLink, preview: boolean) => {
    const log = vi.fn<(line: string) => void>();
    return {
      log,
      run: () =>
        linkBeforeWorker({
          reportLink,
          file: '/out/2026-10-22.md',
          serverKeyName: 'scripts',
          preview,
          scriptName: 'job/x',
          log,
        }),
    };
  };
  const refused: ReportLink = () => Promise.reject(new Error('HTTP 404'));

  it('returns the link resolved with the machine key', async () => {
    const reportLink = vi.fn<ReportLink>(() => Promise.resolve('<u|l>'));
    const { run, log } = request(reportLink, false);
    expect(await run()).toBe('<u|l>');
    expect(reportLink).toHaveBeenCalledWith('/out/2026-10-22.md', 'scripts');
    expect(log).not.toHaveBeenCalled();
  });

  it('fails a live run', async () => {
    await expect(request(refused, false).run()).rejects.toThrow('HTTP 404');
  });

  it('warns in a preview and goes on without a link', async () => {
    const { run, log } = request(refused, true);
    expect(await run()).toBe(NO_LINK);
    expect(NO_LINK).toBe('(no link)');
    expect(log).toHaveBeenCalledWith(
      '[warn] job/x: no insider link for /out/2026-10-22.md; the live run would fail: HTTP 404',
    );
  });
});
