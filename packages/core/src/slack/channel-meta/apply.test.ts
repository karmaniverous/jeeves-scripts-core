/**
 * Tests for applying a value: the right Slack method and parameter per
 * field, verification by re-reading, and refusals returned with Slack's
 * code instead of thrown (any other error, or a code that isn't a plain
 * token, as an unexpected error with its message on stderr only).
 */

import { describe, expect, it, vi } from 'vitest';

import { SlackApiError } from '../../lib/slack-client.js';
import { applyField } from './apply.js';
import { scriptedSlack } from './fakes.test-helper.js';
import { UNEXPECTED } from './report-safe.js';

const info = (purpose: string, topic: string) => () => ({
  channel: { purpose: { value: purpose }, topic: { value: topic } },
});

describe('applyField', () => {
  it('sets the purpose and verifies it (Slack escaping ignored)', async () => {
    const { client, calls } = scriptedSlack({
      'conversations.setPurpose': () => ({}),
      'conversations.info': info('R&amp;D work', ''),
    });
    expect(await applyField(client, 'C1', 'description', 'R&D work')).toEqual({
      ok: true,
      value: 'R&amp;D work',
      verified: true,
    });
    expect(calls[0]).toEqual({
      method: 'conversations.setPurpose',
      params: { channel: 'C1', purpose: 'R&D work' },
    });
    expect(calls[1]).toEqual({
      method: 'conversations.info',
      params: { channel: 'C1' },
    });
  });

  it('sets the topic and flags a value that did not stick', async () => {
    const { client, calls } = scriptedSlack({
      'conversations.setTopic': () => ({}),
      'conversations.info': info('', 'Someone else'),
    });
    expect(await applyField(client, 'C1', 'topic', 'Now: x')).toEqual({
      ok: true,
      value: 'Someone else',
      verified: false,
    });
    expect(calls[0]?.params).toEqual({ channel: 'C1', topic: 'Now: x' });
  });

  it('reads a missing value as empty', async () => {
    const { client } = scriptedSlack({
      'conversations.setTopic': () => ({}),
      'conversations.info': () => ({ channel: {} }),
    });
    expect(await applyField(client, 'C1', 'topic', 'x')).toEqual({
      ok: true,
      value: '',
      verified: false,
    });
  });

  it.each([
    [
      new SlackApiError('conversations.setTopic', 'missing_scope'),
      'missing_scope',
      0,
    ],
    [new Error('network down: Now alpha'), UNEXPECTED, 1],
    [
      new SlackApiError('conversations.setTopic', 'odd "Now alpha"'),
      UNEXPECTED,
      1,
    ],
  ])(
    'returns a refusal (%s) as a failure, Slack codes only',
    async (error, code, warned) => {
      const stderr = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const { client } = scriptedSlack({
        'conversations.setTopic': () => {
          throw error;
        },
      });
      expect(await applyField(client, 'C1', 'topic', 'x')).toEqual({
        ok: false,
        code,
      });
      expect(stderr).toHaveBeenCalledTimes(warned);
      expect(
        stderr.mock.calls.filter(([line]) =>
          String(line).includes('setting the topic of C1: '),
        ),
      ).toHaveLength(warned);
      stderr.mockRestore();
    },
  );
});
