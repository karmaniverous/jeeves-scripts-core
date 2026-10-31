/**
 * @module fetch-notes
 *
 * Fetches Gemini docs and Fathom transcripts for meetings that need them.
 *
 * Scheduled runner job after extraction. Walks the meetings directories of
 * every silo, identifies packages missing notes or transcripts, and
 * delegates to doc-fetch, fathom-extract, or fathom-share-ingest as appropriate.
 */

import fs from 'node:fs';
import path from 'node:path';

import { argFlag, type ParsedArgs } from '@karmaniverous/jeeves';

import { defineRunnable } from '../runnables/define-runnable.js';
import { runDocFetch } from './lib/doc-fetch.js';
import type { DocFetchOptions } from './lib/doc-fetch-scan.js';
import { runFathomExtract } from './lib/fathom-extract.js';
import {
  findShareMeetingsNeedingFetch,
  runFathomShareFetch,
  type ShareCandidate,
} from './lib/fathom-share-ingest.js';
import { getMeetingsDirs, meetingPackages } from './lib/meetings-dirs.js';

/** Fathom HTML extractions per run. */
export const MAX_FATHOM_PER_RUN = 10;
/** Fathom share-page fetches per run. */
export const MAX_FATHOM_SHARE_PER_RUN = 5;

/** What {@link fetchNotes} reads and calls. */
export interface FetchNotesDeps {
  /** The meetings directories (through the silos). */
  meetingsDirs: () => string[];
  /** Meetings with a Fathom share link and no transcript. */
  shareCandidates: () => ShareCandidate[];
  /** Fetch Gemini Docs. */
  docFetch: () => Promise<void>;
  /** Extract transcripts from Fathom HTML. */
  fathomExtract: (options: DocFetchOptions) => void;
  /** Fetch Fathom share pages. */
  shareFetch: (max: number) => Promise<{ fetched: number; errors: number }>;
  /** ISO timestamp. */
  now: () => string;
}

/** The live collaborators. */
export const fetchNotesDeps = (): FetchNotesDeps => ({
  meetingsDirs: getMeetingsDirs,
  shareCandidates: findShareMeetingsNeedingFetch,
  docFetch: () => runDocFetch(),
  fathomExtract: runFathomExtract,
  shareFetch: runFathomShareFetch,
  now: () => new Date().toISOString(),
});

/** Meeting ids whose package lacks a transcript, by how it gets one. */
export function findMeetingsNeedingFetch(meetingsDirs: string[]): {
  geminiNeeded: string[];
  fathomNeeded: string[];
} {
  const geminiNeeded: string[] = [];
  const fathomNeeded: string[] = [];

  const onError = (meetingsDir: string, err: unknown) => {
    console.error(
      `Error scanning ${meetingsDir}: ${err instanceof Error ? err.message : String(err)}`,
    );
  };
  for (const { meetingId, meetingPath: mp } of meetingPackages(
    meetingsDirs,
    onError,
  )) {
    if (fs.existsSync(path.join(mp, 'transcript.txt'))) continue;

    if (fs.existsSync(path.join(mp, 'gemini_link.txt'))) {
      geminiNeeded.push(meetingId);
      continue;
    }

    try {
      const files = fs.readdirSync(mp);
      if (files.some((f) => f.startsWith('fathom-') && f.endsWith('.html'))) {
        fathomNeeded.push(meetingId);
      }
    } catch {
      // Skip
    }
  }

  return { geminiNeeded, fathomNeeded };
}

/** The flags `meetings-fetch-notes` accepts. */
export const fetchNotesFlags = {
  dryRun: argFlag('--dry-run', 'Report what needs fetching; fetch nothing'),
};

/** Fetch what the meetings need, or report it (`--dry-run`). */
export async function fetchNotes(
  flags: ParsedArgs<typeof fetchNotesFlags>,
  deps: FetchNotesDeps,
): Promise<void> {
  const { dryRun } = flags;
  const { geminiNeeded, fathomNeeded } = findMeetingsNeedingFetch(
    deps.meetingsDirs(),
  );
  const fathomShareNeeded = deps.shareCandidates();
  const totalNeeded =
    geminiNeeded.length + fathomNeeded.length + fathomShareNeeded.length;

  if (totalNeeded === 0) {
    if (dryRun)
      console.log(
        JSON.stringify({
          skip: true,
          reason: 'No meetings need transcript fetching',
        }),
      );
    else console.log(`[${deps.now()}] No meetings need transcript fetching`);
    return;
  }

  console.log(
    `[${deps.now()}] Found ${String(geminiNeeded.length)} Gemini + ${String(fathomNeeded.length)} Fathom HTML + ${String(fathomShareNeeded.length)} Fathom share meetings needing transcripts`,
  );

  if (dryRun) {
    console.log(
      JSON.stringify({
        skip: false,
        geminiNeeded: geminiNeeded.slice(0, 50),
        fathomNeeded: fathomNeeded.slice(0, 50),
        fathomShareNeeded: fathomShareNeeded
          .slice(0, 50)
          .map((c) => c.meetingId),
      }),
    );
    return;
  }

  await deps.docFetch();
  deps.fathomExtract({ max: MAX_FATHOM_PER_RUN });

  if (fathomShareNeeded.length > 0) {
    console.log(
      `[${deps.now()}] Fetching Fathom share transcripts (max ${String(MAX_FATHOM_SHARE_PER_RUN)})`,
    );
    const stats = await deps.shareFetch(MAX_FATHOM_SHARE_PER_RUN);
    console.log(
      `[${deps.now()}] Fathom share fetch: ${String(stats.fetched)} fetched, ${String(stats.errors)} errors`,
    );
  }
}

export default defineRunnable({
  id: 'meetings-fetch-notes',
  domain: 'meetings',
  name: 'meetings/fetch-notes',
  flags: fetchNotesFlags,
  run: ({ flags }) => fetchNotes(flags, fetchNotesDeps()),
});
