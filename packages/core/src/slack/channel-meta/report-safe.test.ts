/**
 * Tests for errors as the report may carry them: a Slack refusal as its
 * method and code, anything else (a parser's or schema's message, a
 * Slack error whose method or code isn't a plain token) as the fixed
 * unexpected error, its full message written to stderr only.
 */

import { describe, expect, it, vi } from 'vitest';

import { SlackApiError } from '../../lib/slack-client.js';
import {
  reportSafeCode,
  reportSafeError,
  stderrWarn,
  UNEXPECTED,
} from './report-safe.js';

const refusal = new SlackApiError('conversations.history', 'missing_scope');

describe('reportSafeError / reportSafeCode', () => {
  it('keeps a Slack refusal, warning nothing', () => {
    const warn = vi.fn();
    expect(reportSafeError(refusal, 'reading C1', warn)).toBe(
      'Slack conversations.history failed: missing_scope',
    );
    expect(reportSafeCode(refusal, 'reading C1', warn)).toBe('missing_scope');
    expect(warn).not.toHaveBeenCalled();
  });

  it('drops the detail a Slack refusal carries in its message', () => {
    const detailed = new SlackApiError(
      'conversations.history',
      'invalid_response',
      'body "Now alpha" is not JSON',
    );
    expect(detailed.message).toContain('Now alpha');
    expect(reportSafeError(detailed, 'reading C1', vi.fn())).toBe(
      'Slack conversations.history failed: invalid_response',
    );
  });

  it.each([
    ['a parser message', new SyntaxError('"Now alpha" is not valid JSON')],
    ['a thrown string', 'Now alpha'],
    [
      'a code that quotes',
      new SlackApiError('conversations.info', 'x "Now alpha"'),
    ],
    ['a method that quotes', new SlackApiError('Now alpha', 'missing_scope')],
  ])('reports %s as unexpected, its message on stderr only', (_name, e) => {
    for (const safe of [reportSafeError, reportSafeCode]) {
      const warn = vi.fn();
      expect(safe(e, 'reading C1', warn)).toBe(UNEXPECTED);
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        expect.stringMatching(
          /^\[warn\] slack\/refresh-channel-meta: reading C1: .*Now alpha/,
        ),
      );
    }
  });

  it('warns on stderr by default', () => {
    const stderr = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    expect(reportSafeError(new Error('boom'), 'reading C1')).toBe(UNEXPECTED);
    expect(reportSafeCode(new Error('bang'), 'setting C1')).toBe(UNEXPECTED);
    stderrWarn('direct');
    expect(stderr.mock.calls).toEqual([
      ['[warn] slack/refresh-channel-meta: reading C1: boom'],
      ['[warn] slack/refresh-channel-meta: setting C1: bang'],
      ['direct'],
    ]);
    stderr.mockRestore();
  });
});
