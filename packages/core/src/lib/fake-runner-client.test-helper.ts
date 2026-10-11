/**
 * @module lib/fake-runner-client.test-helper
 *
 * An in-memory jeeves-runner client for tests: state, collection items and
 * queues (enqueue, dequeue, done, fail) with the runner's method shapes,
 * plus the recorded queue outcomes. Test support only.
 */

import type { RunnerClient } from '@karmaniverous/jeeves-runner';

/** A queue item and its outcome. */
export interface FakeQueueItem {
  id: number;
  payload: unknown;
  status: 'pending' | 'claimed' | 'done' | 'failed';
  error?: string;
}

/** The fake client and its inspectable stores. */
export interface FakeRunnerClient {
  client: RunnerClient;
  state: Map<string, string>;
  items: Map<string, Map<string, string>>;
  queues: Map<string, FakeQueueItem[]>;
  closed: () => boolean;
}

/** Build an empty fake runner client. */
export function fakeRunnerClient(): FakeRunnerClient {
  const state = new Map<string, string>();
  const items = new Map<string, Map<string, string>>();
  const queues = new Map<string, FakeQueueItem[]>();
  const byId = new Map<number, FakeQueueItem>();
  let nextId = 1;
  let closed = false;
  const k = (ns: string, key: string): string => `${ns}|${key}`;
  const bucket = (ns: string, key: string): Map<string, string> => {
    const name = k(ns, key);
    const b = items.get(name) ?? new Map<string, string>();
    items.set(name, b);
    return b;
  };
  const queue = (name: string): FakeQueueItem[] => {
    const q = queues.get(name) ?? [];
    queues.set(name, q);
    return q;
  };
  const client: RunnerClient = {
    getState: (ns, key) => state.get(k(ns, key)) ?? null,
    setState: (ns, key, value) => {
      state.set(k(ns, key), value);
    },
    deleteState: (ns, key) => {
      state.delete(k(ns, key));
    },
    hasItem: (ns, key, item) => bucket(ns, key).has(item),
    getItem: (ns, key, item) => bucket(ns, key).get(item) ?? null,
    setItem: (ns, key, item, value) => {
      bucket(ns, key).set(item, value ?? '');
    },
    deleteItem: (ns, key, item) => {
      bucket(ns, key).delete(item);
    },
    countItems: (ns, key) => bucket(ns, key).size,
    pruneItems: (ns, key, keep) => {
      const b = bucket(ns, key);
      const drop = [...b.keys()].slice(0, Math.max(0, b.size - keep));
      for (const d of drop) b.delete(d);
      return drop.length;
    },
    listItemKeys: (ns, key, options) => {
      const keys = [...bucket(ns, key).keys()];
      const ordered = options?.order === 'asc' ? keys : keys.reverse();
      return options?.limit === undefined
        ? ordered
        : ordered.slice(0, options.limit);
    },
    enqueue: (name, payload) => {
      const item: FakeQueueItem = { id: nextId++, payload, status: 'pending' };
      queue(name).push(item);
      byId.set(item.id, item);
      return item.id;
    },
    dequeue: (name, count = 1) =>
      queue(name)
        .filter((i) => i.status === 'pending')
        .slice(0, count)
        .map((i) => {
          i.status = 'claimed';
          return { id: i.id, payload: i.payload };
        }),
    done: (id) => {
      const item = byId.get(id);
      if (item) item.status = 'done';
    },
    fail: (id, error) => {
      const item = byId.get(id);
      if (item) {
        item.status = 'failed';
        if (error !== undefined) item.error = error;
      }
    },
    close: () => {
      closed = true;
    },
  };
  return { client, state, items, queues, closed: () => closed };
}
