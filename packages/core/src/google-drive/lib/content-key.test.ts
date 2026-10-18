import { describe, expect, it, vi } from 'vitest';

import { probeKey, RECONVERT_KEY } from './content-key.js';
import type { DriveClient } from './drive-client.js';
import { emptyRecord, type LedgerRecord } from './ledger.js';
import type { DriveFile } from './types.js';

const doc = { id: 'd1', name: 'Doc', modifiedTime: 't1' } as DriveFile;
const client = (rev: string) => {
  const latestRevisionId = vi.fn((_id: string) => rev);
  return {
    c: { latestRevisionId } as unknown as DriveClient,
    latestRevisionId,
  };
};
const prior = (contentKey: string): LedgerRecord => ({
  ...emptyRecord(),
  written: { contentKey, modifiedTime: 't1', kind: 'text', at: 'now' },
});

describe('probeKey (google-native)', () => {
  it('reuses the stored key without a call when modifiedTime is unchanged', () => {
    const { c, latestRevisionId } = client('r9');
    expect(probeKey(doc, 'google-native', prior('rev:r1'), c)).toBe('rev:r1');
    expect(latestRevisionId).not.toHaveBeenCalled();
  });

  it('re-probes a reconvert-marked record, so an unchanged Doc still re-converts', () => {
    const { c, latestRevisionId } = client('r1');
    const key = probeKey(doc, 'google-native', prior(RECONVERT_KEY), c);
    expect(key).toBe('rev:r1');
    expect(key).not.toBe(RECONVERT_KEY);
    expect(latestRevisionId).toHaveBeenCalledWith('d1');
  });
});
