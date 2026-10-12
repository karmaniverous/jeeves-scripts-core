/**
 * Tests for the recording fetch double: every `HeadersInit` form is
 * recorded under lower-case names, and the reply status and body come
 * back as a real `Response`.
 */

import { describe, expect, it } from 'vitest';

import { fakeFetch } from './fake-fetch.test-helper.js';

const URL_ = 'https://api.example.com/v1/items';

describe('fakeFetch', () => {
  it.each([
    ['a record', { Authorization: 'Bearer t', 'X-Trace': '1' }],
    [
      'a Headers object',
      new Headers({ Authorization: 'Bearer t', 'X-Trace': '1' }),
    ],
    [
      'a tuple array',
      [
        ['Authorization', 'Bearer t'],
        ['X-Trace', '1'],
      ] as [string, string][],
    ],
  ])('records headers given as %s', async (_form, headers) => {
    const fake = fakeFetch(() => ({}));
    await fake.fetch(URL_, { headers });
    expect(fake.calls[0]?.headers).toEqual({
      authorization: 'Bearer t',
      'x-trace': '1',
    });
  });

  it('records the headers of a Request input, and none when there are none', async () => {
    const fake = fakeFetch(() => ({}));
    await fake.fetch(new Request(URL_, { headers: { 'X-Trace': '2' } }));
    await fake.fetch(URL_);
    expect(fake.calls.map((c) => c.headers)).toEqual([{ 'x-trace': '2' }, {}]);
    expect(fake.calls[0]?.url.href).toBe(URL_);
  });

  it('records method and JSON body, and answers with the reply', async () => {
    const fake = fakeFetch((call) => ({
      status: 201,
      body: { echoed: call.body },
    }));
    const res = await fake.fetch(URL_, {
      method: 'POST',
      body: JSON.stringify({ a: 1 }),
    });
    expect(fake.calls[0]).toMatchObject({ method: 'POST', body: { a: 1 } });
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ echoed: { a: 1 } });
    const text = await fakeFetch(() => ({ body: 'plain' })).fetch(URL_);
    await expect(text.text()).resolves.toBe('plain');
  });
});
