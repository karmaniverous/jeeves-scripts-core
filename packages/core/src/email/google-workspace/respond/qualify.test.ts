import { describe, expect, it } from 'vitest';

import { qualifyMessage } from './qualify.js';

const MAILBOX = 'aide@example.com';
const SENDER = 'jane@example.com';
const OPTS = { mailbox: MAILBOX, allowedSenders: [SENDER] };

const PASS_DKIM =
  'mx.google.com; dkim=pass header.i=@example-com.20251104.gappssmtp.com';

function headers(
  overrides: Partial<Parameters<typeof qualifyMessage>[0]> = {},
) {
  return {
    from: `Jane <${SENDER}>`,
    to: `Aide <${MAILBOX}>`,
    cc: '',
    bcc: '',
    authenticationResults: [PASS_DKIM],
    autoSubmitted: '',
    listId: '',
    precedence: '',
    ...overrides,
  };
}

describe('qualifyMessage', () => {
  it('qualifies a normal message from an allowed sender addressed to the mailbox', () => {
    const result = qualifyMessage(headers(), OPTS);
    expect(result).toEqual({
      qualifies: true,
      sender: { name: 'Jane', email: SENDER },
    });
  });

  it('rejects an unparseable From header', () => {
    const result = qualifyMessage(headers({ from: 'not an email' }), OPTS);
    expect(result).toEqual({
      qualifies: false,
      reason: 'From must contain exactly one address',
    });
  });

  it('rejects a From header with more than one address', () => {
    const result = qualifyMessage(
      headers({ from: `Jane <${SENDER}>, Eve <eve@evil.example>` }),
      OPTS,
    );
    expect(result).toEqual({
      qualifies: false,
      reason: 'From must contain exactly one address',
    });
  });

  it('qualifies the real address, not an allowed one quoted in the display name', () => {
    const result = qualifyMessage(
      headers({ from: `"Jane <${SENDER}>" <eve@example.com>` }),
      OPTS,
    );
    expect(result).toEqual({
      qualifies: false,
      reason: 'sender eve@example.com is not in allowedSenders',
    });
  });

  it('rejects an ambiguous From with two angle addresses', () => {
    const result = qualifyMessage(
      headers({ from: `Jane <${SENDER}> <eve@example.com>` }),
      OPTS,
    );
    expect(result).toEqual({
      qualifies: false,
      reason: 'From must contain exactly one address',
    });
  });

  it('rejects a message the mailbox sent itself', () => {
    const result = qualifyMessage(headers({ from: MAILBOX }), OPTS);
    expect(result.qualifies).toBe(false);
  });

  it('rejects a sender not in allowedSenders', () => {
    const result = qualifyMessage(
      headers({ from: 'stranger@example.com' }),
      OPTS,
    );
    expect(result).toEqual({
      qualifies: false,
      reason: 'sender stranger@example.com is not in allowedSenders',
    });
  });

  it('rejects when mailbox is only on Cc, not To', () => {
    const result = qualifyMessage(
      headers({ to: 'someone-else@example.com', cc: MAILBOX }),
      OPTS,
    );
    expect(result).toEqual({
      qualifies: false,
      reason: 'mailbox is only on Cc, not To',
    });
  });

  it('rejects when the mailbox is on neither To nor Cc (BCC)', () => {
    const result = qualifyMessage(
      headers({ to: 'someone-else@example.com', cc: '' }),
      OPTS,
    );
    expect(result).toEqual({
      qualifies: false,
      reason: 'mailbox is not in To or Cc (likely BCC)',
    });
  });

  it('parses a quoted-comma display name in To correctly', () => {
    const result = qualifyMessage(
      headers({ to: `"Doe, Aide" <${MAILBOX}>, other@example.com` }),
      OPTS,
    );
    expect(result.qualifies).toBe(true);
  });

  it('matches the mailbox in To case-insensitively', () => {
    const result = qualifyMessage(
      headers({ to: `Aide <${MAILBOX.toUpperCase()}>` }),
      OPTS,
    );
    expect(result.qualifies).toBe(true);
  });

  it('rejects on DKIM failure', () => {
    const result = qualifyMessage(headers({ authenticationResults: [] }), OPTS);
    if (result.qualifies) throw new Error('expected a rejection');
    expect(result.reason).toMatch(/^DKIM check failed/);
  });

  it('rejects automated/bulk mail', () => {
    const result = qualifyMessage(
      headers({ listId: '<list.example.com>' }),
      OPTS,
    );
    if (result.qualifies) throw new Error('expected a rejection');
    expect(result.reason).toMatch(/^looks automated/);
  });

  it('checks sender/To/DKIM/automated in that order', () => {
    // Fails allowedSenders check first even though DKIM also fails.
    const result = qualifyMessage(
      headers({ from: 'stranger@example.com', authenticationResults: [] }),
      OPTS,
    );
    expect(result).toEqual({
      qualifies: false,
      reason: 'sender stranger@example.com is not in allowedSenders',
    });
  });
});

describe('qualifyMessage: domain patterns (#53)', () => {
  const patterns = (...allowedSenders: string[]) => ({
    mailbox: MAILBOX,
    allowedSenders,
  });
  const SUB_DKIM = 'mx.google.com; dkim=pass header.d=sub.example.com';

  it('qualifies anyone at a domain covered by *@domain', () => {
    const result = qualifyMessage(
      headers({ from: 'Bob <Bob@Example.com>' }),
      patterns('*@example.com'),
    );
    expect(result).toEqual({
      qualifies: true,
      sender: { name: 'Bob', email: 'bob@example.com' },
    });
  });

  it('qualifies a subdomain sender under *@*.domain, not the bare domain', () => {
    const opts = patterns('*@*.example.com');
    const sub = headers({
      from: 'bob@sub.example.com',
      authenticationResults: [SUB_DKIM],
    });
    expect(qualifyMessage(sub, opts).qualifies).toBe(true);
    expect(qualifyMessage(headers({ from: 'bob@example.com' }), opts)).toEqual({
      qualifies: false,
      reason: 'sender bob@example.com is not in allowedSenders',
    });
  });

  it.each(['eve@evil-example.com', 'eve@example.com.evil.com'])(
    'rejects the look-alike %s',
    (from) => {
      const opts = patterns('*@example.com', '*@*.example.com');
      expect(qualifyMessage(headers({ from }), opts)).toEqual({
        qualifies: false,
        reason: `sender ${from} is not in allowedSenders`,
      });
    },
  );

  it('never qualifies the mailbox, even under a covering pattern', () => {
    const from = `Aide <${MAILBOX.toUpperCase()}>`;
    expect(
      qualifyMessage(headers({ from }), patterns('*@example.com')),
    ).toEqual({
      qualifies: false,
      reason: 'message sent by the mailbox itself',
    });
  });

  it('still requires DKIM for a pattern match', () => {
    const result = qualifyMessage(
      headers({ from: 'bob@example.com', authenticationResults: [] }),
      patterns('*@example.com'),
    );
    if (result.qualifies) throw new Error('expected a rejection');
    expect(result.reason).toMatch(/^DKIM check failed/);
  });

  it('rejects a subdomain sender whose DKIM signing domain is the parent', () => {
    const result = qualifyMessage(
      headers({
        from: 'bob@sub.example.com',
        authenticationResults: [
          'mx.google.com; dkim=pass header.d=example.com',
        ],
      }),
      patterns('*@*.example.com'),
    );
    if (result.qualifies) throw new Error('expected a rejection');
    expect(result.reason).toMatch(/^DKIM check failed/);
  });
});
