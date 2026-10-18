import { describe, expect, it, vi } from 'vitest';

import {
  candidate,
  CONFIG,
  MAILBOX,
  makeDeps,
} from './orchestrate.fixtures.js';
import { runEmailRespond } from './orchestrate.js';
import { NO_REPLY_FENCE_INFO } from './task.js';

const OPTIONS = { dryRun: false, mailbox: MAILBOX, label: 'assistant-replied' };

describe('runEmailRespond outcomes', () => {
  it('holds a thread at its hourly cap for a later run', async () => {
    const deps = makeDeps({ threadReplyCountSince: vi.fn(() => 3) });
    const summary = await runEmailRespond(CONFIG, [candidate()], deps, OPTIONS);
    expect(summary).toMatchObject({ capped: 1, attempted: 0 });
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringMatching(/at its hourly reply cap; m1 held/),
    );
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('counts a worker decline on shared To', async () => {
    const deps = makeDeps({
      readFinalText: vi.fn(() =>
        Promise.resolve(`\`\`\`${NO_REPLY_FENCE_INFO}\nNot for me.\n\`\`\``),
      ),
    });
    const shared = candidate({
      headers: { ...candidate().headers, to: `john@example.com, ${MAILBOX}` },
    });
    const summary = await runEmailRespond(CONFIG, [shared], deps, OPTIONS);
    expect(summary).toMatchObject({ attempted: 1, declined: 1, replied: 0 });
    expect(deps.sendReply).not.toHaveBeenCalled();
  });

  it('retries a failed dispatch, then fails it permanently', async () => {
    const failing = () => Promise.resolve({ exitCode: 1, stdout: '' });
    const first = makeDeps({ dispatch: vi.fn(failing) });
    const retry = await runEmailRespond(CONFIG, [candidate()], first, OPTIONS);
    expect(retry.failedRetrying).toEqual(['m1']);
    expect(retry.failedPermanently).toEqual([]);

    const second = makeDeps({
      dispatch: vi.fn(failing),
      getMessageState: vi.fn(() => ({
        status: 'failed' as const,
        attempts: 1,
        at: 'x',
        threadId: 't1',
      })),
    });
    const final = await runEmailRespond(CONFIG, [candidate()], second, OPTIONS);
    expect(final.failedPermanently).toEqual(['m1']);
  });

  it('logs to console when no log seam is given', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const deps = makeDeps({ threadReplyCountSince: vi.fn(() => 3) });
      delete deps.log;
      await runEmailRespond(CONFIG, [candidate()], deps, OPTIONS);
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
