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

import { defineJob } from '../jobs/define-job.js';
import { flag, parseRunnableArgs } from '../lib/args.js';
import { runDocFetch } from './lib/doc-fetch.js';
import { runFathomExtract } from './lib/fathom-extract.js';
import {
  findShareMeetingsNeedingFetch,
  runFathomShareFetch,
  type ShareCandidate,
} from './lib/fathom-share-ingest.js';
import { getMeetingsDirs } from './lib/meetings-dirs.js';

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
  fathomExtract: (argv: string[]) => void;
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

  for (const meetingsDir of meetingsDirs) {
    if (!fs.existsSync(meetingsDir)) continue;
    try {
      const entries = fs.readdirSync(meetingsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const mp = path.join(meetingsDir, entry.name);
        if (fs.existsSync(path.join(mp, 'transcript.txt'))) continue;

        if (fs.existsSync(path.join(mp, 'gemini_link.txt'))) {
          geminiNeeded.push(entry.name);
          continue;
        }

        try {
          const files = fs.readdirSync(mp);
          if (
            files.some((f) => f.startsWith('fathom-') && f.endsWith('.html'))
          ) {
            fathomNeeded.push(entry.name);
          }
        } catch {
          // Skip
        }
      }
    } catch (err) {
      console.error(
        `Error scanning ${meetingsDir}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { geminiNeeded, fathomNeeded };
}

/** Fetch what the meetings need, or report it (`--dry-run`). */
export async function fetchNotes(
  args: readonly string[],
  deps: FetchNotesDeps,
): Promise<void> {
  const { dryRun } = parseRunnableArgs(args, { dryRun: flag('--dry-run') });
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
  deps.fathomExtract([`--max=${String(MAX_FATHOM_PER_RUN)}`]);

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

export default defineJob({
  id: 'meetings-fetch-notes',
  domain: 'meetings',
  name: 'meetings/fetch-notes',
  run: ({ args }) => fetchNotes(args, fetchNotesDeps()),
});
