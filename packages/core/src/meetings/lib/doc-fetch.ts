/**
 * @module doc-fetch
 *
 * Fetch Google Doc transcripts for meetings that have a `gemini_link.txt`
 * but no `transcript.txt`. Uses the gog CLI binary to export doc content.
 */

import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  nowIso,
  readJson,
  sleepAsync as sleep,
  writeJsonAtomic,
} from '@karmaniverous/jeeves';
import {
  getRunnerClient,
  type RunnerClient,
} from '@karmaniverous/jeeves-runner';

import { GOG } from '../../lib/gog.js';
import { writeMeetingMeta } from './meeting-schema.js';
import { getMeetingsDirs } from './meetings-dirs.js';

/** Rate limiting — Google Docs API has a 60 req/min limit for reads. */
const RATE_LIMIT_MS = 2000;

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

interface DocFetchResult {
  ok: boolean;
  content?: string;
  error?: string;
}

interface IndexStore {
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

interface MeetingManifest {
  artifacts?: string[];
  sources?: Array<{ account?: string }>;
  transcriptFetchedAt?: string;
  hasTranscript?: boolean;
  updatedAt?: string;
}

interface FetchState {
  lastRunAt: string | null;
  fetched: number;
  failed: number;
  skipped: number;
  errors: Array<{ meetingId: string; docId: string; error: string }>;
}

// ── Pure helpers ───────────────────────────────────────────────────────

export function parseDocFetchArgs(argv: string[]): DocFetchArgs {
  const out: DocFetchArgs = {
    dryRun: argv.includes('--dry-run'),
    max: null,
  };

  for (const arg of argv) {
    const m = /^--max=(\d+)$/.exec(arg);
    if (m) out.max = Number(m[1]);
  }

  return out;
}

export function extractDocId(url: string | null | undefined): string | null {
  const m = /\/document\/d\/([a-zA-Z0-9_-]+)/.exec(url ?? '');
  return m ? m[1] : null;
}

// ── Filesystem scanning ───────────────────────────────────────────────

function loadIndexIfExists(meetingsDir: string): IndexStore | null {
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

      const meetingId = entry.name;
      const meetingPath = path.join(meetingsDir, meetingId);

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
  }

  return meetings;
}

// ── Doc fetching ──────────────────────────────────────────────────────

function fetchDocContent(docId: string, account: string): DocFetchResult {
  try {
    const r = cp.spawnSync(
      GOG,
      ['docs', 'export', docId, '--account', account, '--format', 'txt'],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    );
    if (r.error) throw r.error;
    if (r.status !== 0) {
      const msg = (r.stderr || r.stdout).trim();
      throw new Error(
        `gog docs export failed (exit ${String(r.status)}): ${msg}`,
      );
    }

    const output = r.stdout.trim();
    const pathMatch = /^path\t(.+)$/m.exec(output);
    if (!pathMatch) {
      return {
        ok: false,
        error: 'Could not parse download path from gog output',
      };
    }

    const downloadPath = pathMatch[1].trim();
    const content = fs.readFileSync(downloadPath, 'utf8');

    return { ok: true, content };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

// ── Main entry point ──────────────────────────────────────────────────

export async function runDocFetch(argv: string[] = []): Promise<void> {
  const args = parseDocFetchArgs(argv);
  const client: RunnerClient = getRunnerClient();

  try {
    const meetingsDirs = getMeetingsDirs();

    const stateJson = client.getState('meetings', 'fetch-state');
    const state: FetchState = stateJson
      ? (JSON.parse(stateJson) as FetchState)
      : {
          lastRunAt: null,
          fetched: 0,
          failed: 0,
          skipped: 0,
          errors: [],
        };

    const indexStores = new Map<string, IndexStore>();
    for (const dir of meetingsDirs) {
      const store = loadIndexIfExists(dir);
      if (store) indexStores.set(dir, store);
    }

    let meetings = findUnfetchedMeetings(meetingsDirs);

    if (
      typeof args.max === 'number' &&
      Number.isFinite(args.max) &&
      args.max >= 0
    ) {
      meetings = meetings.slice(0, args.max);
    }

    console.log(`[doc-fetch] Meetings dirs: ${meetingsDirs.join(', ')}`);
    console.log(
      `[doc-fetch] Found ${String(meetings.length)} meetings with unfetched transcripts`,
    );

    if (meetings.length === 0) {
      console.log('[doc-fetch] Nothing to fetch');
      return;
    }

    if (args.dryRun) {
      for (const m of meetings) {
        console.log(
          `[doc-fetch] WOULD_FETCH ${m.meetingId} docId=${m.docId ?? 'null'} account=${m.account ?? 'null'} dir=${m.meetingsDir}`,
        );
      }
      return;
    }

    let fetched = 0;
    let failed = 0;
    let skipped = 0;
    const errors: Array<{
      meetingId: string;
      docId: string;
      error: string;
    }> = [];

    for (const meeting of meetings) {
      if (!meeting.docId) {
        console.log(
          `[doc-fetch] SKIP ${meeting.meetingId} - no valid doc ID in link`,
        );
        skipped++;
        continue;
      }

      if (!meeting.account) {
        console.log(
          `[doc-fetch] SKIP ${meeting.meetingId} - no account in manifest`,
        );
        skipped++;
        continue;
      }

      console.log(
        `[doc-fetch] Fetching ${meeting.docId} for ${meeting.meetingId}...`,
      );

      const result = fetchDocContent(meeting.docId, meeting.account);

      if (result.ok && result.content) {
        const transcriptPath = path.join(meeting.path, 'transcript.txt');
        fs.writeFileSync(transcriptPath, result.content, 'utf8');
        console.log(
          `[doc-fetch] OK -> ${transcriptPath} (${String(result.content.length)} chars)`,
        );
        fetched++;

        // Update manifest via canonical write path
        const manifest = readJson<MeetingManifest>(meeting.manifestPath, {});
        const artifacts = manifest.artifacts ?? [];
        if (!artifacts.includes('transcript.txt')) {
          artifacts.push('transcript.txt');
        }
        writeMeetingMeta(meeting.path, {
          artifacts,
          transcriptFetchedAt: nowIso(),
          hasTranscript: true,
        });

        // Update index.json (only if it exists for this meetings dir)
        const store = indexStores.get(meeting.meetingsDir);
        if (store?.index.meetings[meeting.meetingId]) {
          store.index.meetings[meeting.meetingId].hasTranscript = true;
          store.index.meetings[meeting.meetingId].artifactCount =
            artifacts.length;
          store.index.meetings[meeting.meetingId].updatedAt = nowIso();
          store.dirty = true;
        }
      } else {
        console.log(
          `[doc-fetch] FAIL ${meeting.docId}: ${result.error ?? 'unknown'}`,
        );
        errors.push({
          meetingId: meeting.meetingId,
          docId: meeting.docId,
          error: result.error ?? 'unknown',
        });
        failed++;
      }

      await sleep(RATE_LIMIT_MS);
    }

    // Update state
    state.lastRunAt = nowIso();
    state.fetched = fetched;
    state.failed = failed;
    state.skipped = skipped;
    state.errors = errors.slice(-10);
    client.setState('meetings', 'fetch-state', JSON.stringify(state));

    // Persist any index.json that existed + changed
    for (const store of indexStores.values()) {
      if (!store.dirty) continue;
      store.index.updatedAt = nowIso();
      writeJsonAtomic(store.indexPath, store.index);
    }

    console.log(
      `[doc-fetch] Done: ${String(fetched)} fetched, ${String(failed)} failed, ${String(skipped)} skipped`,
    );
  } finally {
    client.close();
  }
}
