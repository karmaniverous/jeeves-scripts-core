#!/usr/bin/env tsx
/**
 * @module migrate-fathom
 *
 * Remediates existing Fathom meetings per spec section 9 / Step 6.
 *
 * Called manually or by the runner as a one-shot migration. Re-detects
 * Fathom URLs, reclassifies unknown meetings with Fathom links, fetches
 * missing transcripts via the share-page fetcher, and backs up overwritten
 * files. Default: dry-run; pass --live to execute, --max=N to cap the batch.
 */

import fs from 'node:fs';
import path from 'node:path';

import { runScript } from '@karmaniverous/jeeves';
import {
  getRunnerClient,
  type RunnerClient,
} from '@karmaniverous/jeeves-runner';

import { detectFathomUrl, normalizeFathomUrl } from './lib/detect.js';
import { fetchFathomSharePage } from './lib/fathom-share-fetch.js';
import {
  buildSortTimestampInput,
  checkHasTranscript,
  computeSortTimestamp,
  type FathomKind,
  writeMeetingMeta,
} from './lib/meeting-schema.js';
import { getMeetingsDirs } from './lib/meetings-dirs.js';
import { parseMigrationArgs } from './lib/migration-args.js';
import {
  backupFile,
  type ChangeRecord,
  generateBatchId,
  writeChangeRecord,
} from './lib/migration-backup.js';

// ── Types ───────────────────────────────────────────────────────────

interface FathomCandidate {
  meetingId: string;
  meetingDir: string;
  fathomKind: FathomKind;
  fathomUrl: string;
  existingMeta: Record<string, unknown>;
}

interface MigrationStats {
  scanned: number;
  fathomDetected: number;
  shareProcessed: number;
  callProcessed: number;
  errors: number;
  skippedAlreadyProcessed: number;
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Scan a meeting directory for Fathom URLs in all text/HTML artifacts
 * and in existing metadata.
 */
function detectFathomInPackage(
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

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseMigrationArgs(process.argv.slice(2), 10);
  const batchId = generateBatchId('fathom');
  const meetingsDirs = getMeetingsDirs();

  console.log(
    `[migrate-fathom] Mode: ${args.live ? 'LIVE' : 'DRY-RUN'} | Max: ${String(args.max)} | Batch: ${batchId}`,
  );

  const stats: MigrationStats = {
    scanned: 0,
    fathomDetected: 0,
    shareProcessed: 0,
    callProcessed: 0,
    errors: 0,
    skippedAlreadyProcessed: 0,
  };

  let client: RunnerClient | null = null;
  if (args.live) {
    client = getRunnerClient();
  }

  try {
    // Phase 1: Scan and collect candidates
    const candidates: FathomCandidate[] = [];

    for (const meetingsDir of meetingsDirs) {
      if (!fs.existsSync(meetingsDir)) continue;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(meetingsDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;

        const meetingId = entry.name;
        const meetingDir = path.join(meetingsDir, meetingId);
        stats.scanned++;

        // Skip already-processed (idempotency)
        if (
          client &&
          client.hasItem('meetings', 'migration-fathom', meetingId)
        ) {
          stats.skippedAlreadyProcessed++;
          continue;
        }

        const metaPath = path.join(meetingDir, 'meeting.json');
        let meta: Record<string, unknown> = {};
        try {
          meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<
            string,
            unknown
          >;
        } catch {
          continue;
        }

        const detection = detectFathomInPackage(meetingDir, meta);
        if (!detection) continue;

        stats.fathomDetected++;
        candidates.push({
          meetingId,
          meetingDir,
          fathomKind: detection.kind,
          fathomUrl: detection.url,
          existingMeta: meta,
        });
      }
    }

    console.log(
      `[migrate-fathom] Scanned: ${String(stats.scanned)} | Fathom detected: ${String(stats.fathomDetected)} (share: ${String(candidates.filter((c) => c.fathomKind === 'share').length)}, call: ${String(candidates.filter((c) => c.fathomKind === 'call').length)})`,
    );

    // Phase 2: Process candidates (bounded batch)
    const batch = candidates.slice(0, args.max);

    for (const candidate of batch) {
      const { meetingId, meetingDir, fathomKind, fathomUrl, existingMeta } =
        candidate;

      if (!args.live) {
        console.log(
          `[migrate-fathom] WOULD_PROCESS ${meetingId} kind=${fathomKind} url=${fathomUrl}`,
        );
        continue;
      }

      try {
        const changes: Record<string, string> = {};
        const backedUp: string[] = [];

        // Write fathom_link.txt
        const linkPath = path.join(meetingDir, 'fathom_link.txt');
        if (fs.existsSync(linkPath)) {
          backupFile(meetingDir, 'fathom_link.txt', batchId);
          backedUp.push('fathom_link.txt');
        }
        fs.writeFileSync(linkPath, fathomUrl + '\n', 'utf8');
        changes['fathom_link.txt'] = 'canonical Fathom URL written';

        // Compute sort metadata — full precedence (spec section 3.3)
        const { sortTimestampMs, sortSource } = computeSortTimestamp(
          buildSortTimestampInput(existingMeta, meetingId),
        );
        const date =
          typeof existingMeta.date === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(existingMeta.date)
            ? existingMeta.date
            : new Date().toISOString().slice(0, 10);

        // Kind-specific: fetch share-page artifacts or preserve call transcript
        let fathomTranscriptSource: string | null = null;
        if (fathomKind === 'share') {
          console.log(`[migrate-fathom] Fetching share page: ${fathomUrl}`);
          const content = await fetchFathomSharePage(fathomUrl);

          for (const artifact of ['transcript.txt', 'summary.txt'] as const) {
            if (fs.existsSync(path.join(meetingDir, artifact))) {
              backupFile(meetingDir, artifact, batchId);
              backedUp.push(artifact);
            }
          }

          if (!content.transcript) {
            console.error(
              `[migrate-fathom] SKIP ${meetingId}: share-page returned empty transcript`,
            );
            stats.errors++;
            continue;
          }

          fs.writeFileSync(
            path.join(meetingDir, 'transcript.txt'),
            content.transcript,
            'utf8',
          );
          changes['transcript.txt'] =
            'verbatim transcript from Fathom share page';

          if (content.summary) {
            fs.writeFileSync(
              path.join(meetingDir, 'summary.txt'),
              content.summary,
              'utf8',
            );
            changes['summary.txt'] = 'summary from Fathom share page';
          }

          fathomTranscriptSource = 'share-page';
          stats.shareProcessed++;
        } else {
          fathomTranscriptSource = checkHasTranscript(meetingDir)
            ? 'email-summary'
            : null;
          stats.callProcessed++;
        }

        // Update meeting.json (common to both share and call)
        backupFile(meetingDir, 'meeting.json', batchId);
        backedUp.push('meeting.json');

        const updatedMeta: Record<string, unknown> = {
          ...existingMeta,
          meetingId,
          source: 'fathom',
          date,
          sortTimestampMs,
          sortSource,
          hasTranscript: checkHasTranscript(meetingDir),
          fathomKind,
          fathomUrl,
          fathomTranscriptSource,
          updatedAt: new Date().toISOString(),
          ...(fathomKind === 'share'
            ? { fathomFetchedAt: new Date().toISOString() }
            : {}),
        };

        writeMeetingMeta(meetingDir, updatedMeta);
        changes['meeting.json'] =
          `Fathom ${fathomKind} metadata + canonical fields`;

        // Write change record
        const record: ChangeRecord = {
          meetingId,
          meetingDir,
          timestamp: new Date().toISOString(),
          filesBackedUp: backedUp,
          changes,
        };
        writeChangeRecord(meetingDir, batchId, record);

        // Mark processed in runner state
        client!.setItem(
          'meetings',
          'migration-fathom',
          meetingId,
          JSON.stringify({ status: 'processed', fathomKind, batchId }),
        );

        console.log(
          `[migrate-fathom] PROCESSED ${meetingId} kind=${fathomKind}`,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[migrate-fathom] ERROR ${meetingId}: ${msg}`);
        stats.errors++;
      }
    }

    console.log(
      `[migrate-fathom] Done: scanned=${String(stats.scanned)} detected=${String(stats.fathomDetected)} share=${String(stats.shareProcessed)} call=${String(stats.callProcessed)} errors=${String(stats.errors)} skipped=${String(stats.skippedAlreadyProcessed)}`,
    );

    if (!args.live) {
      console.log(
        '[migrate-fathom] This was a dry run. Pass --live to execute.',
      );
    }
  } finally {
    client?.close();
  }
}

runScript('meetings/migrate-fathom', () => {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
});
