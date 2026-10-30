import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { getTokensFromTranscript } from './worker-transcript.js';

describe('getTokensFromTranscript', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-transcript-'));
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns 0 for a transcript that does not exist', () => {
    expect(getTokensFromTranscript(path.join(dir, 'missing.jsonl'))).toBe(0);
  });

  it('sums totalTokens over the JSON lines, skipping lines without usage or JSON', () => {
    const transcript = path.join(dir, 't.jsonl');
    fs.writeFileSync(
      transcript,
      [
        JSON.stringify({ message: { usage: { totalTokens: 10 } } }),
        'not json',
        JSON.stringify({ message: { usage: {} } }),
        JSON.stringify({ message: { usage: { totalTokens: 5 } } }),
        '',
      ].join('\n'),
    );
    expect(getTokensFromTranscript(transcript)).toBe(15);
  });

  it('logs and counts nothing when the transcript cannot be read', () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    expect(getTokensFromTranscript(dir)).toBe(0);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to read transcript'),
    );
    error.mockRestore();
  });
});
