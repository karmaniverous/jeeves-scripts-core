import { describe, expect, it } from 'vitest';

import {
  drivePathOf,
  driveSegments,
  wantsFrontmatter,
  withFrontmatter,
} from './frontmatter.js';
import type { SnapshotFile } from './types.js';

const file = (over: Partial<SnapshotFile> = {}): SnapshotFile => ({
  file: {
    id: 'F1',
    name: 'Plan.docx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    modifiedTime: '2026-01-01T00:00:00Z',
    owners: [{ emailAddress: 'jane@example.com' }],
  },
  root: { kind: 'identity', label: 'me@example.com' },
  ancestors: [{ id: 'A', name: 'Projects' }],
  pathResolved: true,
  shareIds: [],
  ...over,
});

describe('google-drive frontmatter', () => {
  it('skips frontmatter only for plain text', () => {
    expect(wantsFrontmatter('text')).toBe(false);
    expect(wantsFrontmatter('docx')).toBe(true);
  });

  it('labels the root by identity, shared drive id or unknown', () => {
    expect(drivePathOf(file())).toBe('me@example.com / Projects / Plan.docx');
    expect(
      driveSegments(
        file({ root: { kind: 'drive', label: null, driveId: 'D9' } }),
      )[0],
    ).toBe('shared-drive D9');
    expect(
      driveSegments(file({ root: { kind: 'drive', label: null } }))[0],
    ).toBe('shared-drive ');
    expect(
      driveSegments(file({ root: { kind: 'identity', label: null } }))[0],
    ).toBe('unknown');
  });

  it('prefixes the body, ending it with one newline', () => {
    const out = withFrontmatter(file(), 'body');
    expect(out.startsWith('---\n')).toBe(true);
    expect(out).toContain('driveUrl: "https://drive.google.com/open?id=F1"');
    expect(out).toContain('owner: "jane@example.com"');
    expect(out.endsWith('body\n')).toBe(true);
    expect(withFrontmatter(file(), 'b\n').endsWith('b\n')).toBe(true);
    expect(withFrontmatter(file(), '')).toMatch(/---\n+$/);
  });
});
