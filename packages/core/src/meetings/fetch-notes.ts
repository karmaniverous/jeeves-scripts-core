#!/usr/bin/env tsx
/**
 * @module fetch-notes
 *
 * Fetches Gemini docs and Fathom transcripts for meetings that need them.
 *
 * Called by the runner after extraction. Walks meeting directories discovered
 * via {@link siloRouting}, identifies packages missing notes or transcripts, and
 * delegates to doc-fetch, fathom-extract, or fathom-share-ingest as appropriate.
 */

import fs from 'node:fs';
import path from 'node:path';

import { runScript } from '@karmaniverous/jeeves';

import { siloRouting } from '../config/index.js';
import { runDocFetch } from './lib/doc-fetch.js';
import { runFathomExtract } from './lib/fathom-extract.js';
import {
  findShareMeetingsNeedingFetch,
  runFathomShareFetch,
} from './lib/fathom-share-ingest.js';

const MAX_FATHOM_PER_RUN = 10;
const MAX_FATHOM_SHARE_PER_RUN = 5;

function findMeetingsNeedingFetch(): {
  geminiNeeded: string[];
  fathomNeeded: string[];
} {
  const geminiNeeded: string[] = [];
  const fathomNeeded: string[] = [];
  const routingConfig = siloRouting();
  const meetingsDirs = [path.join(routingConfig.defaultBasePath, 'meetings')];
  for (const silo of Object.values(routingConfig.silos)) {
    meetingsDirs.push(path.join(silo.basePath, 'meetings'));
  }

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

async function main(): Promise<void> {
  const { geminiNeeded, fathomNeeded } = findMeetingsNeedingFetch();
  const fathomShareNeeded = findShareMeetingsNeedingFetch();
  const totalNeeded =
    geminiNeeded.length + fathomNeeded.length + fathomShareNeeded.length;

  if (totalNeeded === 0) {
    if (process.argv.includes('--dry-run'))
      console.log(
        JSON.stringify({
          skip: true,
          reason: 'No meetings need transcript fetching',
        }),
      );
    else
      console.log(
        `[${new Date().toISOString()}] No meetings need transcript fetching`,
      );
    process.exit(0);
  }

  console.log(
    `[${new Date().toISOString()}] Found ${String(geminiNeeded.length)} Gemini + ${String(fathomNeeded.length)} Fathom HTML + ${String(fathomShareNeeded.length)} Fathom share meetings needing transcripts`,
  );

  if (process.argv.includes('--dry-run')) {
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
    process.exit(0);
  }

  await runDocFetch();
  runFathomExtract([`--max=${String(MAX_FATHOM_PER_RUN)}`]);

  if (fathomShareNeeded.length > 0) {
    console.log(
      `[${new Date().toISOString()}] Fetching Fathom share transcripts (max ${String(MAX_FATHOM_SHARE_PER_RUN)})`,
    );
    const stats = await runFathomShareFetch(MAX_FATHOM_SHARE_PER_RUN);
    console.log(
      `[${new Date().toISOString()}] Fathom share fetch: ${String(stats.fetched)} fetched, ${String(stats.errors)} errors`,
    );
  }
}

runScript('meetings/fetch-notes', () => {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
});
