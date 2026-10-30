/**
 * slack-backfill-history (#50): re-read a channel from its first message up
 * to a bound without moving slack-poll's read position, resumably.
 * Fixture: `poll.test-helper`.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  BACKFILL_STATE_NAMESPACE,
  backfillHistory,
  oldestArchivedTs,
  type SlackBackfillDeps,
  slackBackfillDeps,
} from './backfill-history.js';
import { pollSlack } from './poll.js';
import { c1History, usePollFixture } from './poll.test-helper.js';

vi.mock('@karmaniverous/jeeves', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sleepAsync: () => Promise.resolve(),
}));

const { api, deps, runner } = usePollFixture();

/** Serve C1 `n` messages, Slack-ordered (see `c1History`). */
const backlog = (n: number, onFetch?: () => void) => {
  api['conversations.history'] = c1History(n, {}, onFetch);
};

/** Every directory under `root` holding `{ts}.json` files. */
const archiveDirs = (root: string): string[] =>
  fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /^\d+\.\d+\.json$/.test(e.name))
    .map((e) => e.parentPath)
    .filter((d, i, all) => all.indexOf(d) === i);

/** Seed the channel cache and an archive holding C1's newest `keep` messages. */
const seed = async (n: number, keep: number): Promise<string> => {
  fs.mkdirSync(deps().slackDir, { recursive: true });
  backlog(n);
  await pollSlack(deps());
  const [dir] = archiveDirs(deps().slackDir);
  if (!dir) throw new Error('no archive');
  for (const f of fs
    .readdirSync(dir)
    .sort()
    .slice(0, n - keep))
    fs.rmSync(path.join(dir, f));
  return dir;
};

const backfillDeps = (
  over: Partial<SlackBackfillDeps> = {},
): SlackBackfillDeps => {
  const d = deps();
  return {
    slackDir: d.slackDir,
    tokens: d.tokens,
    runner: d.runner,
    config: d.config,
    now: d.now,
    ...over,
  };
};
const progress = () => runner().state.get(`${BACKFILL_STATE_NAMESPACE}|C1`);

describe('slack-backfill-history (#50)', () => {
  it('reads from the first message up to the oldest archived one, leaving the poll position alone', async () => {
    const dir = await seed(30, 10);
    const position = runner().state.get('slack|lastTs-C1');
    expect(oldestArchivedTs(dir)).toBe('220.000001');
    const saved: string[] = [];
    const client = runner().client;
    const setState = client.setState.bind(client);
    client.setState = (ns, key, value) => {
      if (ns === BACKFILL_STATE_NAMESPACE) saved.push(value);
      setState(ns, key, value);
    };
    await backfillHistory({ channel: 'C1' }, backfillDeps());
    client.setState = setState;
    // It stops at the bound: the last position saved is the newest message before it.
    expect(JSON.parse(saved.at(-1) ?? '{}')).toEqual({
      before: '220.000001',
      position: '219.000001',
    });
    const names = fs.readdirSync(dir).sort();
    expect(names).toHaveLength(30);
    expect(names[0]).toBe('200.000001.json');
    expect(runner().state.get('slack|lastTs-C1')).toBe(position);
    expect(progress()).toBeUndefined();
  });

  it('stops at the budget, saves its bound, and resumes on rerun', async () => {
    const dir = await seed(450, 10);
    let clock = 0;
    backlog(450, () => (clock += 30_000));
    const run = backfillDeps({ now: () => clock });
    await backfillHistory({ channel: 'C1' }, run);
    expect(JSON.parse(progress() ?? '{}')).toEqual({
      before: '640.000001',
      position: '399.000001',
    });
    clock = 0;
    await backfillHistory({ channel: 'C1' }, run);
    clock = 0;
    await backfillHistory({ channel: 'C1' }, run);
    expect(fs.readdirSync(dir)).toHaveLength(450);
    expect(progress()).toBeUndefined();
  });

  it('honours an explicit --before', async () => {
    const dir = await seed(30, 10);
    await backfillHistory(
      { channel: 'C1', before: '205.000001' },
      backfillDeps(),
    );
    const names = fs.readdirSync(dir).sort();
    expect(names.slice(0, 6)).toEqual(
      ['200', '201', '202', '203', '204', '220'].map((t) => `${t}.000001.json`),
    );
  });

  it('refuses a missing or unknown channel, and an empty archive without --before', async () => {
    await expect(backfillHistory({}, backfillDeps())).rejects.toThrow(
      '--channel <id> is required',
    );
    await expect(
      backfillHistory({ channel: 'C9' }, backfillDeps()),
    ).rejects.toThrow(/not in the Slack channel cache/);
    fs.mkdirSync(deps().slackDir, { recursive: true });
    api['conversations.history'] = () => ({ ok: true, messages: [] });
    await pollSlack(deps());
    // The suite shares one archive: empty it so C1 has nothing archived.
    for (const dir of archiveDirs(deps().slackDir))
      fs.rmSync(dir, { recursive: true, force: true });
    await expect(
      backfillHistory({ channel: 'C1' }, backfillDeps()),
    ).rejects.toThrow(/Nothing archived for C1/);
  });
});

describe('slack-backfill-history wiring', () => {
  it('skips when the Slack directory does not exist', async () => {
    fs.rmSync(deps().slackDir, { recursive: true, force: true });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await backfillHistory({ channel: 'C1' }, backfillDeps());
    expect(log).toHaveBeenCalledWith(
      '[skip] Slack domain directory not configured',
    );
  });

  it('reads the Slack directory and the slack block from config', () => {
    const live = slackBackfillDeps();
    expect(live.slackDir).toBe(deps().slackDir);
    expect(live.config().backfillBudgetSeconds).toBe(60);
  });
});
