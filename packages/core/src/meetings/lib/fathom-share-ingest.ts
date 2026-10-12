/**
 * @module fathom-share-ingest — Recurring pipeline path for Fathom share meetings that need transcript fetching.
 *
 * Scans meeting silos for share meetings missing transcripts, calls fetchFathomSharePage, writes artifacts and metadata.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  type FathomShareContent,
  fetchFathomSharePage,
} from './fathom-share-fetch.js';
import { checkHasTranscript, writeMeetingMeta } from './meeting-schema.js';
import { getMeetingsDirs } from './meetings-dirs.js';
import { meetingPackages } from './meetings-dirs.js';

// ── Constants ───────────────────────────────────────────────────────

const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

// ── Types ───────────────────────────────────────────────────────────

/** A meeting with a Fathom share link and no transcript yet. */
export interface ShareCandidate {
  meetingId: string;
  meetingDir: string;
  fathomUrl: string;
}

export interface ShareFetchStats {
  scanned: number;
  candidates: number;
  fetched: number;
  errors: number;
}

// ── Helpers ─────────────────────────────────────────────────────────

function readFathomUrl(meetingDir: string): string | null {
  // Try fathom_link.txt first
  const linkPath = path.join(meetingDir, 'fathom_link.txt');
  if (fs.existsSync(linkPath)) {
    const url = fs.readFileSync(linkPath, 'utf8').trim();
    if (url) return url;
  }

  // Fall back to meeting.json fathomUrl
  const metaPath = path.join(meetingDir, 'meeting.json');
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<
      string,
      unknown
    >;
    if (typeof meta.fathomUrl === 'string' && meta.fathomUrl) {
      return meta.fathomUrl;
    }
  } catch {
    // invalid or missing
  }

  return null;
}

function isInCooldown(meta: Record<string, unknown>, now: number): boolean {
  if (typeof meta.fathomFetchedAt !== 'string') return false;
  const fetchedAt = new Date(meta.fathomFetchedAt).getTime();
  return now - fetchedAt < COOLDOWN_MS;
}

// ── Core ────────────────────────────────────────────────────────────

/**
 * Find Fathom share meetings that need transcript fetching.
 *
 * Criteria:
 * - meeting.json.fathomKind === 'share'
 * - transcript.txt absent OR meeting.json.hasTranscript === false
 * - fathom_link.txt or meeting.json.fathomUrl present
 * - Not in cooldown (fathomFetchedAt older than 15 min or absent)
 */
export function findShareMeetingsNeedingFetch(
  meetingsDirs: string[] = getMeetingsDirs(),
  now: number = Date.now(),
): ShareCandidate[] {
  const candidates: ShareCandidate[] = [];

  for (const { meetingId, meetingPath: meetingDir } of meetingPackages(
    meetingsDirs,
  )) {
    if (meetingId.startsWith('.')) continue;
    const metaPath = path.join(meetingDir, 'meeting.json');

    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      continue;
    }

    if (meta.fathomKind !== 'share') continue;
    if (checkHasTranscript(meetingDir) && meta.hasTranscript === true) continue;

    const fathomUrl = readFathomUrl(meetingDir);
    if (!fathomUrl) continue;

    if (isInCooldown(meta, now)) continue;

    candidates.push({
      meetingId: meetingId,
      meetingDir,
      fathomUrl,
    });
  }

  return candidates;
}

/**
 * Fetch transcripts for Fathom share meetings that are missing them.
 *
 * Bounded by `max` to avoid spawning too many headless Chrome instances.
 */
/** What {@link runFathomShareFetch} reads and calls. */
export interface ShareFetchDeps {
  /** The meetings directories (through the silos). */
  meetingsDirs: () => string[];
  /** Read a share page's summary and transcript. */
  fetchPage: (shareUrl: string) => Promise<FathomShareContent>;
  /** Clock (ms). */
  now: () => number;
}

/** The live collaborators. */
const liveShareFetch = (): ShareFetchDeps => ({
  meetingsDirs: getMeetingsDirs,
  fetchPage: (url) => fetchFathomSharePage(url),
  now: Date.now,
});

export async function runFathomShareFetch(
  max: number,
  deps: ShareFetchDeps = liveShareFetch(),
): Promise<ShareFetchStats> {
  const candidates = findShareMeetingsNeedingFetch(
    deps.meetingsDirs(),
    deps.now(),
  );
  const batch = candidates.slice(0, max);
  const stats: ShareFetchStats = {
    scanned: candidates.length,
    candidates: batch.length,
    fetched: 0,
    errors: 0,
  };

  for (const { meetingId, meetingDir, fathomUrl } of batch) {
    try {
      console.log(
        `[fathom-share-ingest] Fetching share page for ${meetingId}: ${fathomUrl}`,
      );

      const content = await deps.fetchPage(fathomUrl);

      if (!content.transcript) {
        console.error(
          `[fathom-share-ingest] SKIP ${meetingId}: empty transcript from share page`,
        );
        stats.errors++;
        continue;
      }

      fs.writeFileSync(
        path.join(meetingDir, 'transcript.txt'),
        content.transcript,
        'utf8',
      );

      if (content.summary) {
        fs.writeFileSync(
          path.join(meetingDir, 'summary.txt'),
          content.summary,
          'utf8',
        );
      }

      writeMeetingMeta(meetingDir, {
        hasTranscript: true,
        fathomTranscriptSource: 'share-page',
        fathomFetchedAt: new Date(deps.now()).toISOString(),
      });

      stats.fetched++;
      console.log(`[fathom-share-ingest] DONE ${meetingId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[fathom-share-ingest] ERROR ${meetingId}: ${msg}`);
      stats.errors++;
    }
  }

  return stats;
}
