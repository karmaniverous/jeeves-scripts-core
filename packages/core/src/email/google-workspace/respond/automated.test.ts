import { describe, expect, it } from 'vitest';

import { checkNotAutomated } from './automated.js';

describe('checkNotAutomated', () => {
  it('passes a normal message with no automation headers', () => {
    expect(checkNotAutomated({})).toEqual({ automated: false });
  });

  it('flags Auto-Submitted present and not "no"', () => {
    expect(checkNotAutomated({ autoSubmitted: 'auto-replied' })).toEqual({
      automated: true,
      reason: 'Auto-Submitted: auto-replied',
    });
  });

  it('does not flag Auto-Submitted: no', () => {
    expect(checkNotAutomated({ autoSubmitted: 'no' })).toEqual({
      automated: false,
    });
  });

  it('is case-insensitive for Auto-Submitted: no', () => {
    expect(checkNotAutomated({ autoSubmitted: 'No' })).toEqual({
      automated: false,
    });
  });

  it('flags List-Id present', () => {
    expect(checkNotAutomated({ listId: '<list.example.com>' })).toEqual({
      automated: true,
      reason: 'List-Id present: <list.example.com>',
    });
  });

  it('flags bulk/list/junk Precedence (case-insensitive)', () => {
    expect(checkNotAutomated({ precedence: 'bulk' }).automated).toBe(true);
    expect(checkNotAutomated({ precedence: 'List' }).automated).toBe(true);
    expect(checkNotAutomated({ precedence: 'JUNK' }).automated).toBe(true);
  });

  it('does not flag other Precedence values', () => {
    expect(checkNotAutomated({ precedence: 'first-class' })).toEqual({
      automated: false,
    });
  });

  it('checks Auto-Submitted before List-Id before Precedence', () => {
    expect(
      checkNotAutomated({
        autoSubmitted: 'auto-generated',
        listId: '<x>',
        precedence: 'bulk',
      }).reason,
    ).toBe('Auto-Submitted: auto-generated');
  });
});
