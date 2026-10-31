/**
 * Tests for message helpers: telling people from bots in archive and API
 * shapes, timestamp ordering and author names.
 */

import { describe, expect, it } from 'vitest';

import {
  authorOf,
  type ChannelMessage,
  compareTs,
  isHumanMessage,
  laterTs,
  tsAt,
} from './messages.js';

const base: ChannelMessage = { ts: '1.000001', user: 'U1', text: 'hi' };

describe('isHumanMessage', () => {
  it.each<[string, ChannelMessage, boolean]>([
    ['a person', base, true],
    [
      'a configured person (name string)',
      { ...base, userName: 'Ann Lee' },
      true,
    ],
    ['a person sharing a file', { ...base, subtype: 'file_share' }, true],
    ['a thread broadcast', { ...base, subtype: 'thread_broadcast' }, true],
    ['an archived bot post', { ...base, botId: 'B1' }, false],
    ['an API bot post', { ...base, bot_id: 'B1' }, false],
    ['a bot user', { ...base, userName: { is_bot: true } }, false],
    ['a join notice', { ...base, subtype: 'channel_join' }, false],
    ['a bot_message', { ...base, subtype: 'bot_message' }, false],
    ['no author', { ts: '1.1', text: 'x' }, false],
  ])('%s: %s', (_label, m, human) => {
    expect(isHumanMessage(m)).toBe(human);
  });
});

describe('timestamps', () => {
  it('compares numerically, not as text', () => {
    expect(compareTs('999.000001', '1000.000000')).toBeLessThan(0);
    expect(compareTs('5.5', '5.000004')).toBeGreaterThan(0);
    expect(compareTs('5.000001', '5.000001')).toBe(0);
    expect(compareTs('5', '5.000000')).toBe(0);
  });

  it('picks the later', () => {
    expect(laterTs(undefined, '2.0')).toBe('2.0');
    expect(laterTs('2.0', undefined)).toBe('2.0');
    expect(laterTs('3.0', '2.0')).toBe('3.0');
    expect(laterTs('2.0', '3.0')).toBe('3.0');
  });

  it('turns an instant into a ts', () => {
    expect(tsAt(1_700_000_000_999)).toBe('1700000000.000000');
  });
});

describe('authorOf', () => {
  it.each<[ChannelMessage, string]>([
    [{ ...base, userName: 'Ann Lee' }, 'Ann Lee'],
    [{ ...base, userName: { alias: 'Ann', name: 'ann' } }, 'Ann'],
    [{ ...base, userName: { name: 'ann' } }, 'ann'],
    [base, 'U1'],
    [{ ts: '1.1' }, 'unknown'],
  ])('%j -> %s', (m, name) => {
    expect(authorOf(m)).toBe(name);
  });
});
