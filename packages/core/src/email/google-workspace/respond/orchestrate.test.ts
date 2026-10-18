import { describe, expect, it, vi } from 'vitest';

import {
  candidate,
  CONFIG,
  MAILBOX,
  makeDeps,
} from './orchestrate.fixtures.js';
import { runEmailRespond } from './orchestrate.js';

describe('runEmailRespond', () => {
  it('end-to-end happy path: discovers, qualifies, sends, labels, records', async () => {
    const deps = makeDeps();
    const summary = await runEmailRespond(CONFIG, [candidate()], deps, {
      dryRun: false,
      mailbox: MAILBOX,
      label: 'assistant-replied',
    });
    expect(summary.replied).toBe(1);
    expect(summary.attempted).toBe(1);
    expect(deps.sendReply).toHaveBeenCalledTimes(1);
  });

  it('dry-run sends nothing and writes no state', async () => {
    const deps = makeDeps();
    const summary = await runEmailRespond(CONFIG, [candidate()], deps, {
      dryRun: true,
      mailbox: MAILBOX,
      label: 'assistant-replied',
    });
    expect(summary.attempted).toBe(0);
    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(deps.sendReply).not.toHaveBeenCalled();
    expect(deps.setMessageState).not.toHaveBeenCalled();
  });

  it('skips an already-handled message without re-qualifying or re-sending', async () => {
    const deps = makeDeps({
      getMessageState: vi.fn(() => ({
        status: 'replied' as const,
        attempts: 1,
        at: 'x',
        threadId: 't1',
      })),
    });
    const summary = await runEmailRespond(CONFIG, [candidate()], deps, {
      dryRun: false,
      mailbox: MAILBOX,
      label: 'assistant-replied',
    });
    expect(summary.alreadyHandled).toBe(1);
    expect(summary.attempted).toBe(0);
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('records a qualification failure as skipped state', async () => {
    const deps = makeDeps();
    const c = candidate({ headers: { ...candidate().headers, listId: '<x>' } });
    const summary = await runEmailRespond(CONFIG, [c], deps, {
      dryRun: false,
      mailbox: MAILBOX,
      label: 'assistant-replied',
    });
    expect(summary.skipped).toBe(1);
    expect(deps.setMessageState).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ status: 'skipped' }),
    );
  });

  it('respects maxPerRun across multiple qualifying candidates', async () => {
    const deps = makeDeps();
    const candidates = [
      candidate({ messageId: 'm1', threadId: 't1', internalDateMs: 1000 }),
      candidate({ messageId: 'm2', threadId: 't2', internalDateMs: 2000 }),
      candidate({ messageId: 'm3', threadId: 't3', internalDateMs: 3000 }),
    ];
    const summary = await runEmailRespond(
      { ...CONFIG, maxPerRun: 2 },
      candidates,
      deps,
      { dryRun: false, mailbox: MAILBOX, label: 'assistant-replied' },
    );
    expect(summary.attempted).toBe(2);
    expect(summary.replied).toBe(2);
  });
});
