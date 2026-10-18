import { describe, expect, it } from 'vitest';

import { addressingOf, buildReplyRecipients } from './recipients.js';

const MAILBOX = 'aide@example.com';

describe('addressingOf', () => {
  it('is sole when the mailbox is the only To addressee', () => {
    expect(addressingOf({ to: `Aide <${MAILBOX}>` }, MAILBOX)).toBe('sole');
  });

  it('is sole when the mailbox is repeated, in any case', () => {
    expect(
      addressingOf({ to: `AIDE@example.com, Aide <${MAILBOX}>` }, MAILBOX),
    ).toBe('sole');
  });

  it('is shared when To has more than one addressee', () => {
    expect(
      addressingOf({ to: `john@example.com, Aide <${MAILBOX}>` }, MAILBOX),
    ).toBe('shared');
  });
});

describe('buildReplyRecipients', () => {
  it('replies to the sender alone on a sole message', () => {
    expect(
      buildReplyRecipients(
        { to: MAILBOX, cc: '', bcc: '' },
        'mark@example.com',
        MAILBOX,
      ),
    ).toEqual({ to: ['mark@example.com'], cc: [], bcc: [] });
  });

  it('preserves every original To, Cc and Bcc addressee, minus the mailbox', () => {
    expect(
      buildReplyRecipients(
        {
          to: `John <john@example.com>, Jane <jane@example.com>, ${MAILBOX}`,
          cc: 'alex@example.com',
          bcc: 'quiet@example.com',
        },
        'mark@example.com',
        MAILBOX,
      ),
    ).toEqual({
      to: ['mark@example.com', 'john@example.com', 'jane@example.com'],
      cc: ['alex@example.com'],
      bcc: ['quiet@example.com'],
    });
  });

  it('dedupes case-insensitively across lists, first occurrence wins', () => {
    expect(
      buildReplyRecipients(
        {
          to: 'Mark@Example.com, john@example.com',
          cc: 'JOHN@example.com, alex@example.com',
          bcc: 'alex@example.com',
        },
        'mark@example.com',
        MAILBOX,
      ),
    ).toEqual({
      to: ['mark@example.com', 'john@example.com'],
      cc: ['alex@example.com'],
      bcc: [],
    });
  });

  it('drops the mailbox from Cc and Bcc too', () => {
    expect(
      buildReplyRecipients(
        { to: 'john@example.com', cc: MAILBOX, bcc: MAILBOX.toUpperCase() },
        'mark@example.com',
        MAILBOX,
      ),
    ).toEqual({
      to: ['mark@example.com', 'john@example.com'],
      cc: [],
      bcc: [],
    });
  });
});
