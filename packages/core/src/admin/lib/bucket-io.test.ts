/**
 * Tests for bucket I/O utilities.
 */

import { describe, expect, it } from 'vitest';

import type { HourlyBucket } from '../types/token-metrics.js';
import {
  currentHourBoundaryMs,
  emptyModelEntry,
  mergeBuckets,
  mergeUsage,
  tsToHour,
} from './bucket-io.js';

describe('tsToHour', () => {
  it('converts epoch 0 to 1970-01-01T00', () => {
    expect(tsToHour(0)).toBe('1970-01-01T00');
  });

  it('converts a known timestamp', () => {
    // 2026-03-15T14:30:00Z
    const ts = new Date('2026-03-15T14:30:00Z').getTime();
    expect(tsToHour(ts)).toBe('2026-03-15T14');
  });

  it('truncates minutes/seconds', () => {
    const ts = new Date('2026-06-01T23:59:59Z').getTime();
    expect(tsToHour(ts)).toBe('2026-06-01T23');
  });
});

describe('currentHourBoundaryMs', () => {
  it('returns a value aligned to the hour', () => {
    const boundary = currentHourBoundaryMs();
    const d = new Date(boundary);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
    expect(d.getUTCMilliseconds()).toBe(0);
  });

  it('is <= now', () => {
    expect(currentHourBoundaryMs()).toBeLessThanOrEqual(Date.now());
  });
});

describe('mergeUsage', () => {
  it('creates a new bucket for unknown hours', () => {
    const buckets = new Map<string, HourlyBucket>();
    mergeUsage(buckets, '2026-03-15T10', 'test-channel', 'test/model', {
      input: { count: 10, cost: 0.001 },
      output: { count: 20, cost: 0.002 },
      cacheRead: { count: 0, cost: 0 },
      cacheWrite: { count: 0, cost: 0 },
    });

    expect(buckets.size).toBe(1);
    const bucket = buckets.get('2026-03-15T10');
    expect(bucket).toBeDefined();
    expect(
      bucket?.channels['test-channel']?.models['test/model']?.input.count,
    ).toBe(10);
  });

  it('accumulates into existing buckets', () => {
    const buckets = new Map<string, HourlyBucket>();
    const usage = {
      input: { count: 10, cost: 0.001 },
      output: { count: 20, cost: 0.002 },
      cacheRead: { count: 0, cost: 0 },
      cacheWrite: { count: 0, cost: 0 },
    };
    mergeUsage(buckets, '2026-03-15T10', 'ch', 'model', usage);
    mergeUsage(buckets, '2026-03-15T10', 'ch', 'model', usage);

    const entry = buckets.get('2026-03-15T10')?.channels['ch']?.models['model'];
    expect(entry?.input.count).toBe(20);
    expect(entry?.input.cost).toBeCloseTo(0.002);
  });
});

describe('mergeBuckets', () => {
  it('deep-merges two buckets', () => {
    const existing: HourlyBucket = {
      hour: '2026-03-15T10',
      channels: {
        ch1: {
          models: {
            m1: {
              input: { count: 10, cost: 0.001 },
              output: { count: 20, cost: 0.002 },
              cacheRead: { count: 0, cost: 0 },
              cacheWrite: { count: 0, cost: 0 },
            },
          },
        },
      },
    };
    const incoming: HourlyBucket = {
      hour: '2026-03-15T10',
      channels: {
        ch1: {
          models: {
            m1: {
              input: { count: 5, cost: 0.0005 },
              output: { count: 10, cost: 0.001 },
              cacheRead: { count: 100, cost: 0.0001 },
              cacheWrite: { count: 0, cost: 0 },
            },
          },
        },
        ch2: {
          models: {
            m1: emptyModelEntry(),
          },
        },
      },
    };

    const merged = mergeBuckets(existing, incoming);

    const ch1m1 = merged.channels['ch1'].models['m1'];
    expect(ch1m1.input.count).toBe(15);
    expect(ch1m1.output.cost).toBeCloseTo(0.003);
    expect(merged.channels).toHaveProperty('ch2');
  });
});
