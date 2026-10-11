import { describe, expect, it } from 'vitest';

import { parseCCLine, projectToChannel } from './claude-code-scanner.js';

describe('claude-code-scanner', () => {
  describe('parseCCLine', () => {
    it('extracts usage from valid assistant line', () => {
      const line = JSON.stringify({
        type: 'assistant',
        timestamp: '2025-05-15T10:00:00Z',
        message: {
          model: 'claude-opus-4-6',
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
            cache_read_input_tokens: 200,
            cache_creation_input_tokens: 50,
          },
        },
      });

      const result = parseCCLine(line);
      expect(result).not.toBeNull();
      expect(result!.modelKey).toBe('anthropic/claude-opus-4-6');
      expect(result!.usage).toEqual({
        input: 1000,
        output: 500,
        cacheRead: 200,
        cacheWrite: 50,
      });
      expect(result!.tsMs).toBe(new Date('2025-05-15T10:00:00Z').getTime());
    });

    it('returns null for non-assistant type', () => {
      const line = JSON.stringify({
        type: 'user',
        timestamp: '2025-05-15T10:00:00Z',
        message: { model: 'claude-opus-4-6', usage: { input_tokens: 100 } },
      });
      expect(parseCCLine(line)).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      expect(parseCCLine('not json at all')).toBeNull();
    });

    it('returns null when message has no usage', () => {
      const line = JSON.stringify({
        type: 'assistant',
        timestamp: '2025-05-15T10:00:00Z',
        message: { model: 'claude-opus-4-6' },
      });
      expect(parseCCLine(line)).toBeNull();
    });

    it('returns null for synthetic model', () => {
      const line = JSON.stringify({
        type: 'assistant',
        timestamp: '2025-05-15T10:00:00Z',
        message: {
          model: '<synthetic>',
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      });
      expect(parseCCLine(line)).toBeNull();
    });

    it('returns null when all token counts are zero', () => {
      const line = JSON.stringify({
        type: 'assistant',
        timestamp: '2025-05-15T10:00:00Z',
        message: {
          model: 'claude-opus-4-6',
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      });
      expect(parseCCLine(line)).toBeNull();
    });

    it('returns null when timestamp is missing', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          model: 'claude-opus-4-6',
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      });
      expect(parseCCLine(line)).toBeNull();
    });

    it('handles numeric timestamp in seconds', () => {
      const tsSec = 1715770800; // seconds
      const line = JSON.stringify({
        type: 'assistant',
        timestamp: tsSec,
        message: {
          model: 'claude-opus-4-6',
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      });

      const result = parseCCLine(line);
      expect(result).not.toBeNull();
      expect(result!.tsMs).toBe(tsSec * 1000);
    });

    it('handles numeric timestamp in milliseconds', () => {
      const tsMs = 1715770800000;
      const line = JSON.stringify({
        type: 'assistant',
        timestamp: tsMs,
        message: {
          model: 'claude-opus-4-6',
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      });

      const result = parseCCLine(line);
      expect(result).not.toBeNull();
      expect(result!.tsMs).toBe(tsMs);
    });

    it('maps dated snapshot model names', () => {
      const line = JSON.stringify({
        type: 'assistant',
        timestamp: '2025-05-15T10:00:00Z',
        message: {
          model: 'claude-sonnet-4-20250514',
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      });

      const result = parseCCLine(line);
      expect(result).not.toBeNull();
      expect(result!.modelKey).toBe('anthropic/claude-sonnet-4-5');
    });

    it('prefixes unknown dated snapshots with anthropic/', () => {
      const line = JSON.stringify({
        type: 'assistant',
        timestamp: '2025-05-15T10:00:00Z',
        message: {
          model: 'claude-haiku-5-20260101',
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      });

      const result = parseCCLine(line);
      expect(result).not.toBeNull();
      expect(result!.modelKey).toBe('anthropic/claude-haiku-5-20260101');
    });

    it('passes through non-claude model names unchanged', () => {
      const line = JSON.stringify({
        type: 'assistant',
        timestamp: '2025-05-15T10:00:00Z',
        message: {
          model: 'gpt-4o',
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      });

      const result = parseCCLine(line);
      expect(result).not.toBeNull();
      expect(result!.modelKey).toBe('gpt-4o');
    });

    it('defaults missing token fields to zero', () => {
      const line = JSON.stringify({
        type: 'assistant',
        timestamp: '2025-05-15T10:00:00Z',
        message: {
          model: 'claude-opus-4-6',
          usage: { input_tokens: 100 },
        },
      });

      const result = parseCCLine(line);
      expect(result).not.toBeNull();
      expect(result!.usage).toEqual({
        input: 100,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      });
    });
  });
});

describe('projectToChannel', () => {
  it('strips D--repos- prefix', () => {
    const result = projectToChannel('D--repos-myorg-my-project');
    expect(result).toEqual({
      key: 'cc:myorg-my-project',
      name: 'CC: myorg-my-project',
    });
  });

  it('strips drive letter and repos container', () => {
    const result = projectToChannel('C--repos-acme-widget');
    expect(result).toEqual({ key: 'cc:acme-widget', name: 'CC: acme-widget' });
  });

  it('strips drive letter and projects container', () => {
    const result = projectToChannel('D--projects-my-app');
    expect(result).toEqual({ key: 'cc:my-app', name: 'CC: my-app' });
  });

  it('strips bare drive letter prefix', () => {
    const result = projectToChannel('J--jeeves');
    expect(result).toEqual({ key: 'cc:jeeves', name: 'CC: jeeves' });
  });

  it('preserves name without drive prefix', () => {
    const result = projectToChannel('some-project');
    expect(result).toEqual({
      key: 'cc:some-project',
      name: 'CC: some-project',
    });
  });
});
