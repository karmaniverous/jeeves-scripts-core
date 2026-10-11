/**
 * @module lib/fake-fetch.test-helper
 *
 * A recording `fetch` double for tests: each request is passed to a handler
 * that returns a JSON body (and optional status), answered with a real
 * `Response`. Test support only.
 */

/** One recorded request. */
export interface FetchCall {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** What the handler answers. */
export interface FakeReply {
  status?: number;
  body?: unknown;
}

/** A fake fetch and the requests it saw. */
export interface FakeFetch {
  fetch: typeof fetch;
  calls: FetchCall[];
}

/** Build a fake fetch answering through `handler`. */
export function fakeFetch(handler: (call: FetchCall) => FakeReply): FakeFetch {
  const calls: FetchCall[] = [];
  const impl = (input: string | URL | Request, init?: RequestInit) => {
    const raw = init?.body;
    const call: FetchCall = {
      url: new URL(input instanceof Request ? input.url : String(input)),
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body: typeof raw === 'string' ? (JSON.parse(raw) as unknown) : undefined,
    };
    calls.push(call);
    const reply = handler(call);
    const text =
      typeof reply.body === 'string'
        ? reply.body
        : JSON.stringify(reply.body ?? {});
    return Promise.resolve(new Response(text, { status: reply.status ?? 200 }));
  };
  return { fetch: impl, calls };
}
