/**
 * @module fathom-extract
 *
 * Extract Fathom transcripts from `fathom-*.html` into `transcript.txt`.
 *
 * Scans all meeting silos for meetings that have `fathom-*.html` but no
 * `transcript.txt`. For each match, extracts the hidden transcript block,
 * writes `transcript.txt`, and updates `meeting.json`.
 */

import fs from 'node:fs';
import path from 'node:path';

import { nowIso, readJson } from '@karmaniverous/jeeves';

import { writeMeetingMeta } from './meeting-schema.js';
import { getMeetingsDirs } from './meetings-dirs.js';

// ── Types ──────────────────────────────────────────────────────────────

interface FathomArgs {
  dryRun: boolean;
  max: number | null;
}

interface FathomMeeting {
  meetingId: string;
  meetingPath: string;
  meetingsDir: string;
  fathomHtmlFile: string;
  manifestPath: string;
}

interface MeetingManifest {
  artifacts?: string[];
  transcriptExtractedAt?: string;
  hasTranscript?: boolean;
  updatedAt?: string;
  fathomKind?: string;
  fathomUrl?: string;
}

// ── Pure helpers ───────────────────────────────────────────────────────

export function parseFathomArgs(argv: string[]): FathomArgs {
  const out: FathomArgs = {
    dryRun: argv.includes('--dry-run'),
    max: null,
  };

  for (const arg of argv) {
    const m = /^--max=(\d+)$/.exec(arg);
    if (m) out.max = Number(m[1]);
  }

  return out;
}

export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (full, hex: string) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return full;
      }
    })
    .replace(/&#(\d+);/g, (full, dec: string) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch {
        return full;
      }
    });
}

export function isFathomShareManifest(manifest: MeetingManifest): boolean {
  return (
    manifest.fathomKind === 'share' ||
    /\/share\//i.test(manifest.fathomUrl ?? '')
  );
}

export function extractHiddenDivInnerHtml(html: string): string | null {
  const marker = '<div style="display:none;">Meeting Purpose';
  let start = html.indexOf(marker);

  // If marker not found, fall back to first div with style display:none
  if (start === -1) {
    const re =
      /<div\b[^>]*\bstyle\s*=\s*"\s*display\s*:\s*none\s*;?\s*"[^>]*>/i;
    const m = re.exec(html);
    if (!m) return null;
    start = m.index;
  }

  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = start;

  const first = tagRe.exec(html);
  if (!first || first.index !== start || first[0].startsWith('</')) return null;

  const startTagEnd = first.index + first[0].length;
  let depth = 1;
  let endTagStart = -1;

  while (depth > 0) {
    const m = tagRe.exec(html);
    if (!m) break;
    if (m[0].startsWith('</')) depth--;
    else depth++;

    if (depth === 0) {
      endTagStart = m.index;
      break;
    }
  }

  if (endTagStart === -1) return null;
  return html.slice(startTagEnd, endTagStart);
}

export function htmlToText(html: string): string {
  let s = html;

  // Newline-preserving conversions
  s = s.replace(/<\s*br\s*\/?>/gi, '\n');
  s = s.replace(/<\s*\/\s*(p|div|h[1-6]|li|tr)\s*>/gi, '\n');
  s = s.replace(/<\s*li\b[^>]*>/gi, '- ');

  // Strip remaining tags
  s = s.replace(/<[^>]*>/g, '');

  s = decodeHtmlEntities(s);

  // Normalize whitespace
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.replace(/[ \t]+/g, ' ');

  return s.trim() + '\n';
}

// ── Filesystem scanning ───────────────────────────────────────────────

function listFathomHtmlFiles(meetingPath: string): string[] {
  try {
    const files = fs.readdirSync(meetingPath);
    return files.filter((f) => f.startsWith('fathom-') && f.endsWith('.html'));
  } catch {
    return [];
  }
}

function pickBestFathomHtml(
  meetingPath: string,
  files: string[],
): string | null {
  let best: string | null = null;
  let bestMtime = 0;

  for (const f of files) {
    const full = path.join(meetingPath, f);
    try {
      const st = fs.statSync(full);
      const t = st.mtimeMs;
      if (!best || t > bestMtime) {
        best = f;
        bestMtime = t;
      }
    } catch {
      // ignore
    }
  }

  if (best) return best;
  return files.slice().sort().at(-1) ?? null;
}

function findMeetingsNeedingFathom(meetingsDirs: string[]): FathomMeeting[] {
  const out: FathomMeeting[] = [];

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
      const transcriptPath = path.join(meetingPath, 'transcript.txt');
      if (fs.existsSync(transcriptPath)) continue;
      if (
        isFathomShareManifest(
          readJson<MeetingManifest>(path.join(meetingPath, 'meeting.json'), {}),
        )
      )
        continue;

      const fathomFiles = listFathomHtmlFiles(meetingPath);
      if (fathomFiles.length === 0) continue;

      const best = pickBestFathomHtml(meetingPath, fathomFiles);
      if (!best) continue;

      out.push({
        meetingId,
        meetingPath,
        meetingsDir,
        fathomHtmlFile: best,
        manifestPath: path.join(meetingPath, 'meeting.json'),
      });
    }
  }

  return out;
}

// ── Main entry point ──────────────────────────────────────────────────

export function runFathomExtract(argv: string[] = []): void {
  const args = parseFathomArgs(argv);
  const meetingsDirs = getMeetingsDirs();
  let meetings = findMeetingsNeedingFathom(meetingsDirs);

  if (
    typeof args.max === 'number' &&
    Number.isFinite(args.max) &&
    args.max >= 0
  ) {
    meetings = meetings.slice(0, args.max);
  }

  console.log(`[fathom-extract] Meetings dirs: ${meetingsDirs.join(', ')}`);
  console.log(
    `[fathom-extract] Found ${String(meetings.length)} meetings needing extraction`,
  );

  if (meetings.length === 0) return;

  if (args.dryRun) {
    for (const m of meetings) {
      console.log(
        `[fathom-extract] WOULD_EXTRACT ${m.meetingId} file=${m.fathomHtmlFile} dir=${m.meetingsDir}`,
      );
    }
    return;
  }

  let ok = 0;
  let failed = 0;

  for (const m of meetings) {
    const htmlPath = path.join(m.meetingPath, m.fathomHtmlFile);
    console.log(`[fathom-extract] Extracting ${m.meetingId} from ${htmlPath}`);

    try {
      const html = fs.readFileSync(htmlPath, 'utf8');
      const inner = extractHiddenDivInnerHtml(html);
      if (!inner) throw new Error('Could not locate hidden transcript div');

      const text = htmlToText(inner);
      const transcriptPath = path.join(m.meetingPath, 'transcript.txt');
      fs.writeFileSync(transcriptPath, text, 'utf8');

      // Update manifest via canonical write path
      const manifest = readJson<MeetingManifest>(m.manifestPath, {});
      const artifacts = manifest.artifacts ?? [];
      if (!artifacts.includes('transcript.txt')) {
        artifacts.push('transcript.txt');
      }
      writeMeetingMeta(m.meetingPath, {
        artifacts,
        transcriptExtractedAt: nowIso(),
        hasTranscript: true,
      });

      console.log(
        `[fathom-extract] OK -> ${transcriptPath} (${String(text.length)} chars)`,
      );
      ok++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[fathom-extract] FAIL ${m.meetingId}: ${msg}`);
      failed++;
    }
  }

  console.log(
    `[fathom-extract] Done: ${String(ok)} OK, ${String(failed)} failed`,
  );
  if (failed > 0) process.exit(1);
}
