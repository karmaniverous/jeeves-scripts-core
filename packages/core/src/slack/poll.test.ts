/**
 * End-to-end test of the Slack poller over a temp archive and a scripted
 * Slack Web API (`poll.test-helper`): workspace lookup, discovery,
 * history, thread replies, message files and read positions. Backlogs
 * are in `poll-backlog.test.ts`.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { pollSlack, slackPollDeps } from './poll.js';
import { usePollFixture } from './poll.test-helper.js';

vi.mock('@karmaniverous/jeeves', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sleepAsync: () => Promise.resolve(),
}));

const { baseDir, deps, files, runner } = usePollFixture();

describe('pollSlack', () => {
  it('skips when the Slack directory does not exist', async () => {
    await pollSlack(deps());
    expect(console.log).toHaveBeenCalledWith(
      '[skip] Slack domain directory not configured',
    );
    expect(runner().closed()).toBe(false);
  });

  it('writes new messages and replies, saves read positions and carries on past a failing channel', async () => {
    fs.mkdirSync(deps().slackDir, { recursive: true });
    await pollSlack(deps());
    const written = files(deps().slackDir);
    expect(
      written.filter((f) => f.endsWith('.json')).length,
    ).toBeGreaterThanOrEqual(3);
    expect(console.error).toHaveBeenCalledWith(
      'ERROR C2: Slack conversations.history failed: not_in_channel',
    );
    expect(console.log).toHaveBeenCalledWith('Total: 3 new messages');
    expect(runner().state.get('slack|lastTs-C1')).toBe('100.2');
    expect(runner().closed()).toBe(true);

    vi.mocked(console.log).mockClear();
    await pollSlack(deps());
    expect(console.log).not.toHaveBeenCalledWith(
      expect.stringMatching(/^Total:/),
    );
  });

  it('still polls a renamed channel whose directory cannot be renamed, writing to the existing one', async () => {
    const oldDir = path.join(deps().slackDir, 'old-name (C1)');
    fs.rmSync(deps().slackDir, { recursive: true, force: true });
    fs.mkdirSync(oldDir, { recursive: true });
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('EPERM: operation not permitted, rename'), {
        code: 'EPERM',
      });
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await pollSlack(deps());
    expect(warn).toHaveBeenCalledWith(
      'WARN C1: could not rename "old-name (C1)" -> "general (C1)" (EPERM); keeping "old-name (C1)"',
    );
    expect(console.error).not.toHaveBeenCalledWith(
      expect.stringMatching(/^ERROR C1:/),
    );
    expect(files(oldDir).filter((f) => f.endsWith('.json')).length).toBe(3);
    expect(fs.existsSync(path.join(deps().slackDir, 'general (C1)'))).toBe(
      false,
    );
    expect(runner().state.get('slack|lastTs-C1')).toBe('100.2');
  });
});

describe('slackPollDeps', () => {
  it('reads the Slack directory and the slack block from config', () => {
    const live = slackPollDeps();
    expect(live.slackDir).toBe(path.join(baseDir(), 'content', 'slack'));
    expect(live.config().backfillBudgetSeconds).toBe(60);
    expect(live.config().newChannelLookbackDays).toBeUndefined();
  });
});
