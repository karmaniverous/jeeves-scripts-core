/**
 * @module meetings/lib/fathom-package-detect
 *
 * Find a Fathom recording link in an existing meeting package (its text
 * and HTML artifacts and its metadata), for `meetings/migrate-fathom`.
 */

import fs from 'node:fs';
import path from 'node:path';

import { detectFathomUrl, normalizeFathomUrl } from './detect.js';
import { type FathomKind } from './meeting-schema.js';

// ── Types ───────────────────────────────────────────────────────────

export interface FathomCandidate {
  meetingId: string;
  meetingDir: string;
  fathomKind: FathomKind;
  fathomUrl: string;
  existingMeta: Record<string, unknown>;
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Scan a meeting directory for Fathom URLs in all text/HTML artifacts
 * and in existing metadata.
 */
export function detectFathomInPackage(
  meetingDir: string,
  meta: Record<string, unknown>,
): { kind: FathomKind; url: string } | null {
  // Check existing fathomUrl
  if (typeof meta.fathomUrl === 'string' && meta.fathomUrl) {
    const kind =
      meta.fathomKind === 'share' || meta.fathomKind === 'call'
        ? meta.fathomKind
        : meta.fathomUrl.includes('/share/')
          ? 'share'
          : 'call';
    return { kind, url: normalizeFathomUrl(meta.fathomUrl) };
  }

  // Check fathom_link.txt
  const linkPath = path.join(meetingDir, 'fathom_link.txt');
  if (fs.existsSync(linkPath)) {
    const url = fs.readFileSync(linkPath, 'utf8').trim();
    const detection = detectFathomUrl(url);
    if (detection) return detection;
  }

  // Scan text/HTML artifacts for Fathom URLs
  try {
    const files = fs.readdirSync(meetingDir);
    for (const file of files) {
      if (
        !file.endsWith('.txt') &&
        !file.endsWith('.html') &&
        file !== 'meeting.json'
      )
        continue;
      if (file === 'meeting.json') continue;

      try {
        const content = fs.readFileSync(path.join(meetingDir, file), 'utf8');
        const detection = detectFathomUrl(content);
        if (detection) return detection;
      } catch {
        // skip unreadable files
      }
    }
  } catch {
    // skip unreadable dirs
  }

  return null;
}
