import { describe, expect, it } from 'vitest';

import {
  checkDkim,
  isDkimDomainMatch,
  isGappssmtpAlias,
  parseAuthenticationResults,
} from './dkim.js';

const REAL_HEADER =
  'mx.google.com;       dkim=pass header.i=@example-com.20251104.gappssmtp.com header.s=20251104 header.b=AsjEvrZZ;       arc=pass (i=1);       spf=none (google.com: aide@example.com does not designate permitted sender hosts) smtp.mailfrom=aide@example.com;       dara=neutral header.i=@example.com';

describe('parseAuthenticationResults', () => {
  it('parses the authserv-id and dkim clause from the real-world header', () => {
    const parsed = parseAuthenticationResults(REAL_HEADER);
    expect(parsed.authServId).toBe('mx.google.com');
    expect(parsed.dkimResults).toEqual([
      {
        result: 'pass',
        identityDomain: 'example-com.20251104.gappssmtp.com',
      },
    ]);
  });

  it('ignores header.i on a non-dkim clause (dara=)', () => {
    const parsed = parseAuthenticationResults(REAL_HEADER);
    // Only one dkim= clause parsed, even though dara= also has header.i.
    expect(parsed.dkimResults).toHaveLength(1);
  });

  it('takes the domain after the last @ when header.i is user@domain', () => {
    const parsed = parseAuthenticationResults(
      'mx.google.com; dkim=pass header.i=aide@example.com',
    );
    expect(parsed.dkimResults[0]?.identityDomain).toBe('example.com');
  });

  it('prefers header.d over header.i when both are present', () => {
    const parsed = parseAuthenticationResults(
      'mx.google.com; dkim=pass header.i=@mail.example.com header.d=example.com',
    );
    expect(parsed.dkimResults[0]?.identityDomain).toBe('example.com');
  });

  it('falls back to header.i domain when header.d is absent', () => {
    const parsed = parseAuthenticationResults(
      'mx.google.com; dkim=pass header.i=@example.com',
    );
    expect(parsed.dkimResults[0]?.identityDomain).toBe('example.com');
  });

  it('handles multiple dkim= clauses (one per signing domain)', () => {
    const parsed = parseAuthenticationResults(
      'mx.google.com; dkim=pass header.i=@a.com; dkim=fail header.i=@b.com',
    );
    expect(parsed.dkimResults).toEqual([
      { result: 'pass', identityDomain: 'a.com' },
      { result: 'fail', identityDomain: 'b.com' },
    ]);
  });

  it('records a dkim clause with no identity as null', () => {
    const parsed = parseAuthenticationResults('mx.google.com; dkim=none');
    expect(parsed.dkimResults).toEqual([
      { result: 'none', identityDomain: null },
    ]);
  });
});

describe('isGappssmtpAlias', () => {
  it('matches Google Workspace default signing domain for example.com', () => {
    expect(
      isGappssmtpAlias('example-com.20251104.gappssmtp.com', 'example.com'),
    ).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(
      isGappssmtpAlias('EXAMPLE-COM.20251104.GAPPSSMTP.COM', 'example.com'),
    ).toBe(true);
  });

  it('does not match another domain', () => {
    expect(
      isGappssmtpAlias('example-com.20251104.gappssmtp.com', 'other.com'),
    ).toBe(false);
  });

  it('does not match a non-gappssmtp domain', () => {
    expect(isGappssmtpAlias('example.com', 'example.com')).toBe(false);
  });

  it('rejects a sender domain with unsafe characters for a regex', () => {
    expect(isGappssmtpAlias('example.com', 'example.com); (evil')).toBe(false);
  });
});

describe('isDkimDomainMatch', () => {
  it('matches an identical domain', () => {
    expect(isDkimDomainMatch('example.com', 'example.com')).toBe(true);
  });

  it('matches a gappssmtp alias of the sender domain', () => {
    expect(
      isDkimDomainMatch('example-com.20251104.gappssmtp.com', 'example.com'),
    ).toBe(true);
  });

  it('rejects an unrelated domain', () => {
    expect(isDkimDomainMatch('evil.com', 'example.com')).toBe(false);
  });
});

describe('checkDkim', () => {
  it('passes on the real-world header for its own sender domain', () => {
    expect(checkDkim([REAL_HEADER], 'example.com')).toEqual({ ok: true });
  });

  it('passes with dkim=pass header.i=@domain matching senderDomain exactly', () => {
    expect(
      checkDkim(
        ['mx.google.com; dkim=pass header.i=@example.com'],
        'example.com',
      ),
    ).toEqual({ ok: true });
  });

  it('passes with header.i=user@domain (domain after last @)', () => {
    expect(
      checkDkim(
        ['mx.google.com; dkim=pass header.i=aide@example.com'],
        'example.com',
      ),
    ).toEqual({ ok: true });
  });

  it('prefers header.d for the match', () => {
    expect(
      checkDkim(
        [
          'mx.google.com; dkim=pass header.i=@mail.example.com header.d=example.com',
        ],
        'example.com',
      ),
    ).toEqual({ ok: true });
  });

  it('fails when the signing domain does not match the sender domain', () => {
    const result = checkDkim(
      ['mx.google.com; dkim=pass header.i=@evil.com'],
      'example.com',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no dkim=pass/);
  });

  it('fails on dkim=fail', () => {
    const result = checkDkim(
      ['mx.google.com; dkim=fail header.i=@example.com'],
      'example.com',
    );
    expect(result.ok).toBe(false);
  });

  it('fails when there is no Authentication-Results header', () => {
    expect(checkDkim([], 'example.com')).toEqual({
      ok: false,
      reason: 'missing Authentication-Results header',
    });
  });

  it('fails when the topmost header is not from mx.google.com', () => {
    const result = checkDkim(
      ['some-other-mx.example.com; dkim=pass header.i=@example.com'],
      'example.com',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not mx\.google\.com/);
  });

  it('never trusts a forged lower header, even if it claims mx.google.com', () => {
    // The topmost header (added last, by Google) is not trusted; a
    // second, lower copy claiming mx.google.com could have been forged
    // by the sender before the message ever reached Google, so it must
    // never be consulted, even to find a dkim=pass.
    const forgedLower = 'mx.google.com; dkim=pass header.i=@example.com';
    const topmostUntrusted =
      'relay.example.com; dkim=fail header.i=@example.com';
    const result = checkDkim([topmostUntrusted, forgedLower], 'example.com');
    expect(result.ok).toBe(false);
  });
});
