import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { drainXQueue } from './drain-x-queue.js';

const labels = { actionLabel: 'like', successLabel: 'liked' };

function fakeClient(payloads: unknown[]) {
  return {
    dequeue: vi.fn(() =>
      payloads.map((payload, i) => ({ id: i + 1, payload })),
    ),
    done: vi.fn(),
    fail: vi.fn(),
  };
}

let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('drainXQueue', () => {
  it('acks items whose action returns true', async () => {
    const client = fakeClient([{ tweetId: 't1' }, { tweetId: 't2' }]);
    const act = vi.fn(() => Promise.resolve(true));

    const result = await drainXQueue(client, 'x-like-k', 5, act, labels, 'k');

    expect(client.dequeue).toHaveBeenCalledWith('x-like-k', 5);
    expect(act.mock.calls).toEqual([['t1'], ['t2']]);
    expect(client.done.mock.calls).toEqual([[1], [2]]);
    expect(client.fail).not.toHaveBeenCalled();
    expect(result).toEqual({ succeeded: 2, failed: 0 });
    expect(log).toHaveBeenLastCalledWith('like: @k liked=2, failed=0');
  });

  it('fails, not acks, an item whose action returns false', async () => {
    const client = fakeClient([{ tweetId: 't1' }, { tweetId: 't2' }]);
    const act = vi.fn((id: string) => Promise.resolve(id === 't2'));

    const result = await drainXQueue(client, 'q', 5, act, labels, 'ghost');

    expect(client.fail).toHaveBeenCalledWith(
      1,
      '@ghost did not resolve to an X user',
    );
    expect(client.done.mock.calls).toEqual([[2]]);
    expect(result).toEqual({ succeeded: 1, failed: 1 });
    expect(log).toHaveBeenLastCalledWith('like: @ghost liked=1, failed=1');
  });

  it('fails an item whose action throws, with the error message', async () => {
    const client = fakeClient([{ tweetId: 't1' }]);
    const act = vi.fn(() => Promise.reject(new Error('429 Too Many')));

    const result = await drainXQueue(client, 'q', 5, act, labels, 'k');

    expect(client.fail).toHaveBeenCalledWith(1, '429 Too Many');
    expect(client.done).not.toHaveBeenCalled();
    expect(result).toEqual({ succeeded: 0, failed: 1 });
  });

  it('settles items without a tweet id as done without acting or counting', async () => {
    const client = fakeClient([{}, null]);
    const act = vi.fn(() => Promise.resolve(true));

    const result = await drainXQueue(client, 'q', 5, act, labels, 'k');

    expect(act).not.toHaveBeenCalled();
    expect(client.done.mock.calls).toEqual([[1], [2]]);
    expect(result).toEqual({ succeeded: 0, failed: 0 });
  });
});
