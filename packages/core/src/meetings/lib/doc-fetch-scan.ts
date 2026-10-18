/**
 * @module meetings/lib/doc-fetch-scan
 *
 * Which meetings `doc-fetch` still has to fetch: CLI arguments, the Google
 * Doc id in a Gemini link, and the meetings with a `gemini_link.txt` but
 * no transcript, from the meetings index when present.
 */

import fs from 'node:fs';
import path from 'node:path';

import { readJson } from '@karmaniverous/jeeves';

import { meetingPackages } from './meetings-dirs.js';

// ── Types ──────────────────────────────────────────────────────────────

interface DocFetchArgs {
  dryRun: boolean;
  max: number | null;
}

interface UnfetchedMeeting {
  meetingId: string;
  path: string;
  link: string;
  docId: string | null;
  account: string | null;
  manifestPath: string;
  meetingsDir: string;
}

export interface IndexStore {
  meetingsDir: string;
  indexPath: string;
  index: MeetingsIndex;
  dirty: boolean;
}

interface MeetingsIndex {
  meetings: Record<string, MeetingIndexEntry>;
  updatedAt: string | null;
}

interface MeetingIndexEntry {
  hasTranscript?: boolean;
  artifactCount?: number;
  updatedAt?: string;
}

// ── Pure helpers ───────────────────────────────────────────────────────

/** Fetch options: report only (`dryRun`), at most `max` meetings. */
export interface DocFetchOptions {
  dryRun?: boolean;
  max?: number | null;
}

/** {@link DocFetchOptions} with defaults applied. */
export function docFetchArgs(options: DocFetchOptions = {}): DocFetchArgs {
  return { dryRun: options.dryRun ?? false, max: options.max ?? null };
}

export function extractDocId(url: string | null | undefined): string | null {
  const m = /\/document\/d\/([a-zA-Z0-9_-]+)/.exec(url ?? '');
  return m?.[1] ?? null;
}

// ── Filesystem scanning ───────────────────────────────────────────────

export function loadIndexIfExists(meetingsDir: string): IndexStore | null {
  const indexPath = path.join(meetingsDir, 'index.json');
  if (!fs.existsSync(indexPath)) return null;
  return {
    meetingsDir,
    indexPath,
    index: readJson<MeetingsIndex>(indexPath, {
      meetings: {},
      updatedAt: null,
    }),
    dirty: false,
  };
}

export function findUnfetchedMeetings(
  meetingsDirs: string[],
): UnfetchedMeeting[] {
  const meetings: UnfetchedMeeting[] = [];

  for (const { meetingsDir, meetingId, meetingPath } of meetingPackages(
    meetingsDirs,
  )) {
    const linkPath = path.join(meetingPath, 'gemini_link.txt');
    const transcriptPath = path.join(meetingPath, 'transcript.txt');
    const manifestPath = path.join(meetingPath, 'meeting.json');

    if (!fs.existsSync(linkPath)) continue;
    if (fs.existsSync(transcriptPath)) continue;

    const link = fs.readFileSync(linkPath, 'utf8').trim();
    const manifest = readJson<MeetingManifest>(manifestPath, {});

    const firstSource = (manifest.sources ?? [])[0] ?? {};
    const account = firstSource.account ?? null;

    meetings.push({
      meetingId,
      path: meetingPath,
      link,
      docId: extractDocId(link),
      account,
      manifestPath,
      meetingsDir,
    });
  }

  return meetings;
}

export interface MeetingManifest {
  artifacts?: string[];
  sources?: { account?: string }[];
  transcriptFetchedAt?: string;
  hasTranscript?: boolean;
  updatedAt?: string;
}
