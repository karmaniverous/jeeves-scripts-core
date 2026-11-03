/**
 * Tests for session refresh's settings: the delta fields with their
 * defaults, and each retired environment variable failing the run naming
 * the field that replaces it.
 */

import { describe, expect, it } from 'vitest';

import {
  SESSION_REFRESH_CONTEXT_THRESHOLD,
  SESSION_REFRESH_IDLE_MINUTES,
} from '../../lib/constants.js';
import { LEGACY_ENV, refreshSettings } from './session-refresh-settings.js';

describe('refreshSettings', () => {
  it('applies every default with no delta or no fields', () => {
    for (const delta of [undefined, {}]) {
      const s = refreshSettings(delta, {});
      expect(s.contextThreshold).toBe(SESSION_REFRESH_CONTEXT_THRESHOLD);
      expect(s.contextThreshold).toBe(150_000);
      expect(s.idleMinutes).toBe(SESSION_REFRESH_IDLE_MINUTES);
      expect(s.idleMinutes).toBe(60);
      expect([...s.excludedKeys]).toEqual([]);
    }
  });

  it('reads the delta fields', () => {
    const s = refreshSettings(
      { contextThreshold: 9, idleMinutes: 90, excludedKeys: ['a', 'b'] },
      { UNRELATED: '1' },
    );
    expect(s).toEqual({
      contextThreshold: 9,
      idleMinutes: 90,
      excludedKeys: new Set(['a', 'b']),
    });
  });

  it.each([
    ['CACHE_READ_THRESHOLD', 'contextThreshold'],
    ['IDLE_MINUTES', 'idleMinutes'],
    ['EXCLUDED_SESSION_KEYS', 'excludedKeys'],
  ])('fails while %s is set, naming %s', (name, field) => {
    expect(() => refreshSettings({}, { [name]: '' })).toThrow(
      `move ${name} to jobs.admin-refresh-sessions.${field}`,
    );
  });

  it('names every retired variable that is set', () => {
    expect(Object.keys(LEGACY_ENV)).toHaveLength(3);
    expect(() =>
      refreshSettings(undefined, {
        IDLE_MINUTES: '5',
        CACHE_READ_THRESHOLD: '1',
      }),
    ).toThrow(
      'admin-refresh-sessions no longer reads CACHE_READ_THRESHOLD, IDLE_MINUTES',
    );
  });
});
