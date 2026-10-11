import { describe, expect, it, vi } from 'vitest';

vi.mock('./rate-card.js', () => ({
  computeCosts: vi.fn(),
}));

import { computeCosts } from './rate-card.js';
import { normalizeUsage, parseUsageLine } from './usage-parser.js';

// ── parseUsageLine ──────────────────────────────────────────────────

describe('parseUsageLine', () => {
  it('returns null for invalid JSON', () => {
    expect(parseUsageLine('not json{')).toBeNull();
  });

  it('returns null when type is not "message"', () => {
    const line = JSON.stringify({
      type: 'error',
      message: { usage: { cost: { total: 1 } } },
    });
    expect(parseUsageLine(line)).toBeNull();
  });

  it('returns null when message is missing', () => {
    const line = JSON.stringify({ type: 'message' });
    expect(parseUsageLine(line)).toBeNull();
  });

  it('returns null when message.usage is missing', () => {
    const line = JSON.stringify({ type: 'message', message: { model: 'x' } });
    expect(parseUsageLine(line)).toBeNull();
  });

  it('returns null when usage has neither cost nor totalTokens', () => {
    const line = JSON.stringify({
      type: 'message',
      timestamp: '2025-01-01T00:00:00Z',
      message: { usage: { input: 100 } },
    });
    expect(parseUsageLine(line)).toBeNull();
  });

  it('parses ISO string timestamp from outer object', () => {
    const line = JSON.stringify({
      type: 'message',
      timestamp: '2025-06-15T12:30:00Z',
      message: { model: 'claude', usage: { totalTokens: 100 } },
    });
    const result = parseUsageLine(line);
    expect(result).not.toBeNull();
    expect(result!.tsMs).toBe(new Date('2025-06-15T12:30:00Z').getTime());
  });

  it('treats numeric timestamp > 1e12 as milliseconds', () => {
    const tsMs = 1718451600000; // already ms
    const line = JSON.stringify({
      type: 'message',
      timestamp: tsMs,
      message: { model: 'claude', usage: { totalTokens: 50 } },
    });
    const result = parseUsageLine(line);
    expect(result!.tsMs).toBe(tsMs);
  });

  it('treats numeric timestamp <= 1e12 as seconds and converts to ms', () => {
    const tsSec = 1718451600; // seconds
    const line = JSON.stringify({
      type: 'message',
      timestamp: tsSec,
      message: { model: 'claude', usage: { totalTokens: 50 } },
    });
    const result = parseUsageLine(line);
    expect(result!.tsMs).toBe(tsSec * 1000);
  });

  it('falls back to message.timestamp when outer timestamp is absent', () => {
    const tsMs = 1718451600000;
    const line = JSON.stringify({
      type: 'message',
      message: { model: 'claude', timestamp: tsMs, usage: { totalTokens: 10 } },
    });
    const result = parseUsageLine(line);
    expect(result!.tsMs).toBe(tsMs);
  });

  it('converts message.timestamp from seconds to ms when <= 1e12', () => {
    const tsSec = 1718451600;
    const line = JSON.stringify({
      type: 'message',
      message: {
        model: 'claude',
        timestamp: tsSec,
        usage: { totalTokens: 10 },
      },
    });
    const result = parseUsageLine(line);
    expect(result!.tsMs).toBe(tsSec * 1000);
  });

  it('returns null when no timestamp is available at all', () => {
    const line = JSON.stringify({
      type: 'message',
      message: { model: 'claude', usage: { totalTokens: 10 } },
    });
    expect(parseUsageLine(line)).toBeNull();
  });

  it('returns null when parsed timestamp is NaN (invalid ISO string)', () => {
    const line = JSON.stringify({
      type: 'message',
      timestamp: 'not-a-date',
      message: { model: 'claude', usage: { totalTokens: 10 } },
    });
    expect(parseUsageLine(line)).toBeNull();
  });

  it('defaults model to "unknown" when not a string', () => {
    const line = JSON.stringify({
      type: 'message',
      timestamp: '2025-01-01T00:00:00Z',
      message: { model: 42, usage: { totalTokens: 10 } },
    });
    const result = parseUsageLine(line);
    expect(result!.model).toBe('unknown');
  });

  it('defaults provider to "unknown" when not present', () => {
    const line = JSON.stringify({
      type: 'message',
      timestamp: '2025-01-01T00:00:00Z',
      message: { model: 'claude', usage: { totalTokens: 10 } },
    });
    const result = parseUsageLine(line);
    expect(result!.provider).toBe('unknown');
  });

  it('returns full parsed result with all fields', () => {
    const usage = {
      input: 100,
      output: 200,
      cacheRead: 50,
      cacheWrite: 25,
      totalTokens: 375,
      cost: { input: 0.01, output: 0.02, total: 0.03 },
    };
    const line = JSON.stringify({
      type: 'message',
      timestamp: '2025-06-15T14:00:00Z',
      message: { model: 'claude-opus', provider: 'anthropic', usage },
    });
    const result = parseUsageLine(line);
    expect(result).toEqual({
      tsMs: new Date('2025-06-15T14:00:00Z').getTime(),
      model: 'claude-opus',
      provider: 'anthropic',
      rawUsage: usage,
    });
  });
});

// ── normalizeUsage ──────────────────────────────────────────────────

describe('normalizeUsage', () => {
  it('calls computeCosts and assembles count+cost per category', () => {
    vi.mocked(computeCosts).mockReturnValue({
      input: 0.15,
      output: 0.75,
      cacheRead: 0.03,
      cacheWrite: 0.05,
    });

    const raw = { input: 1000, output: 500, cacheRead: 200, cacheWrite: 100 };
    const result = normalizeUsage(raw, 'anthropic/claude-opus');

    expect(computeCosts).toHaveBeenCalledWith('anthropic/claude-opus', {
      input: 1000,
      output: 500,
      cacheRead: 200,
      cacheWrite: 100,
    });

    expect(result).toEqual({
      input: { count: 1000, cost: 0.15 },
      output: { count: 500, cost: 0.75 },
      cacheRead: { count: 200, cost: 0.03 },
      cacheWrite: { count: 100, cost: 0.05 },
    });
  });

  it('treats undefined/missing counts as 0', () => {
    vi.mocked(computeCosts).mockReturnValue({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });

    const raw = {}; // no counts at all
    const result = normalizeUsage(raw, 'some-model');

    expect(computeCosts).toHaveBeenCalledWith('some-model', {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });

    expect(result.input.count).toBe(0);
    expect(result.output.count).toBe(0);
    expect(result.cacheRead.count).toBe(0);
    expect(result.cacheWrite.count).toBe(0);
  });
});
