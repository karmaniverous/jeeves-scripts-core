/**
 * @module notion-inbox-processor
 *
 * Process a Notion Inbox meeting page: fetch metadata via Notion API,
 * extract content via browser, stage artifacts locally, create an archive
 * copy in Notion, and archive the inbox page.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { getRef } from '../../config/index.js';
import { constants } from '../../lib/constants.js';
import { writeMeetingMeta } from './meeting-schema.js';
import { notionRequest } from './notion-api.js';
import {
  appendBlocks,
  chunkText,
  headingBlock,
  type NotionBlock,
  type NotionRequest,
  paragraphBlock,
} from './notion-blocks.js';
import {
  type ExtractedContent,
  extractFromPublicPage,
} from './notion-browser-extract.js';

// ── Constants ──────────────────────────────────────────────────────────

/** What {@link processNotionInboxMeeting} reads and calls. */
export interface NotionInboxDeps {
  /** Notion REST call. */
  request: NotionRequest;
  /** Read a published page's tabs. */
  extract: (publicUrl: string) => Promise<ExtractedContent>;
  /** The default meetings directory (holds `index.json`). */
  meetingsDir: () => string;
  /** The Archive database id (`notion.archiveDatabaseId` ref). */
  archiveDatabaseId: () => string;
  /** ISO timestamp. */
  now: () => string;
}

/** The live collaborators, from config when used (never at import). */
export const notionInboxDeps = (): NotionInboxDeps => ({
  request: notionRequest,
  extract: extractFromPublicPage,
  meetingsDir: () => constants().DEFAULT_MEETINGS_DIR,
  archiveDatabaseId: () => getRef('notion.archiveDatabaseId'),
  now: () => new Date().toISOString(),
});

// ── Types ──────────────────────────────────────────────────────────────

interface NotionPage {
  id: string;
  created_time: string;
  public_url?: string;
  properties?: {
    Meeting?: { title?: { plain_text: string }[] };
  };
}

interface MeetingsIndex {
  meetings: Record<string, MeetingIndexEntry>;
  updatedAt: string;
}

interface MeetingIndexEntry {
  title: string;
  normalizedTitle: string;
  date: string;
  participantCount: number;
  sourceCount: number;
  artifactCount: number;
  updatedAt: string;
  hasTranscript: boolean;
}

interface MeetingManifest {
  meetingId: string;
  source: string;
  title: string;
  date: string;
  sortTimestampMs: number | null;
  sortSource: string;
  hasTranscript: boolean;
  participants: string[];
  sources: { kind: string; pageId: string; url: string }[];
  createdAt: string;
  ingestedAt: string;
}

// ── Pure helpers ───────────────────────────────────────────────────────

export function cleanTitle(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/\s+@\w.*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sha1Prefix(s: string, len = 12): string {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, len);
}

// ── Index helpers ──────────────────────────────────────────────────────

function upsertMeetingsIndex(
  meetingId: string,
  entry: MeetingIndexEntry,
  deps: Pick<NotionInboxDeps, 'meetingsDir' | 'now'>,
): void {
  const meetingsIndexPath = (): string =>
    path.join(deps.meetingsDir(), 'index.json');
  let idx: MeetingsIndex = {
    meetings: {},
    updatedAt: deps.now(),
  };
  try {
    idx = JSON.parse(
      fs.readFileSync(meetingsIndexPath(), 'utf8'),
    ) as MeetingsIndex;
  } catch {
    // ignore
  }
  idx.meetings[meetingId] = { ...idx.meetings[meetingId], ...entry };
  idx.updatedAt = deps.now();
  fs.writeFileSync(meetingsIndexPath(), JSON.stringify(idx, null, 2));
}

// ── Main processor ─────────────────────────────────────────────────────

/**
 * Stage one published Inbox page as a meeting package, copy it to the
 * Archive database and archive the Inbox page.
 *
 * @throws When the page is unpublished or yields no text (the page stays put).
 */
export async function processNotionInboxMeeting(
  pageId: string,
  deps: NotionInboxDeps = notionInboxDeps(),
): Promise<void> {
  const page = (await deps.request(
    'GET',
    `/v1/pages/${pageId}`,
    null,
  )) as NotionPage;
  const createdTime = page.created_time;
  const publicUrl = page.public_url;
  if (!publicUrl) {
    throw new Error(
      `Inbox page has no public_url (is it published?): ${pageId}`,
    );
  }

  const extracted: ExtractedContent = await deps.extract(publicUrl);

  const summaryText = extracted.tabs.summary;
  const notesText = extracted.tabs.notes;
  const transcriptText = extracted.tabs.transcript;
  const fallbackText = extracted.fullText;

  // HARD GATE: abort without archiving if no usable text
  if (
    !summaryText.trim() &&
    !notesText.trim() &&
    !transcriptText.trim() &&
    !fallbackText.trim()
  ) {
    throw new Error(
      'Extraction produced no text (summary/notes/transcript/fullText all empty) — leaving Inbox page in place',
    );
  }

  const titleCandidate =
    cleanTitle(extracted.h2) ||
    cleanTitle(
      (page.properties?.Meeting?.title ?? []).map((t) => t.plain_text).join(''),
    ) ||
    cleanTitle(summaryText.split('\n').find((l) => l.trim())) ||
    cleanTitle(transcriptText.split('\n').find((l) => l.trim())) ||
    `Meeting ${createdTime.slice(0, 10)}`;

  const title = titleCandidate.slice(0, 80);
  const meetingId = sha1Prefix(pageId);
  const meetingDir = path.join(deps.meetingsDir(), meetingId);
  fs.mkdirSync(meetingDir, { recursive: true });

  // Compute sort timestamp from Notion page creation time
  const createdMs = new Date(createdTime).getTime();
  const sortTimestampMs = Number.isFinite(createdMs) ? createdMs : null;
  const hasTranscript = !!(transcriptText || fallbackText);

  const manifest: MeetingManifest = {
    meetingId,
    source: 'notion-public',
    title,
    date: createdTime.slice(0, 10),
    sortTimestampMs,
    sortSource: sortTimestampMs != null ? 'meeting-timestamp' : 'fallback',
    hasTranscript,
    participants: [],
    sources: [{ kind: 'notion-public', pageId, url: publicUrl }],
    createdAt: createdTime,
    ingestedAt: deps.now(),
  };

  writeMeetingMeta(meetingDir, { ...manifest });
  if (summaryText)
    fs.writeFileSync(path.join(meetingDir, 'summary.txt'), summaryText);
  if (notesText)
    fs.writeFileSync(path.join(meetingDir, 'notes.txt'), notesText);
  if (transcriptText) {
    fs.writeFileSync(path.join(meetingDir, 'transcript.txt'), transcriptText);
  } else if (fallbackText) {
    fs.writeFileSync(path.join(meetingDir, 'transcript.txt'), fallbackText);
  }

  upsertMeetingsIndex(
    meetingId,
    {
      title,
      normalizedTitle: title.toLowerCase(),
      date: createdTime.slice(0, 10),
      participantCount: 0,
      sourceCount: 1,
      artifactCount: 3,
      updatedAt: deps.now(),
      hasTranscript,
    },
    deps,
  );

  // Archive copy + Inbox archive only after successful local staging
  const archivePage = (await deps.request('POST', '/v1/pages', {
    parent: { database_id: deps.archiveDatabaseId() },
    properties: {
      Meeting: {
        title: [{ type: 'text', text: { content: title } }],
      },
      Created: { date: { start: createdTime } },
    },
  })) as { id: string };

  const archivePageId = archivePage.id;

  const effectiveTranscript = transcriptText.trim()
    ? transcriptText
    : fallbackText;

  const blocks: NotionBlock[] = [
    headingBlock('Ingested Copy (Summary / Notes / Transcript)', 2),
    paragraphBlock(
      'Created by Jeeves ingestion from the published Inbox page.',
    ),
    headingBlock('Summary', 2),
    ...(summaryText.trim()
      ? chunkText(summaryText).map(paragraphBlock)
      : [paragraphBlock('(empty)')]),
    headingBlock('Notes', 2),
    ...(notesText.trim()
      ? chunkText(notesText).map(paragraphBlock)
      : [paragraphBlock('(empty)')]),
    headingBlock('Transcript', 2),
    ...(effectiveTranscript.trim()
      ? chunkText(effectiveTranscript).map(paragraphBlock)
      : [paragraphBlock('(empty)')]),
  ];

  await appendBlocks(archivePageId, blocks, deps.request);
  await deps.request('PATCH', `/v1/pages/${pageId}`, { archived: true });

  console.log(
    `Processed meeting ${meetingId} from Inbox page ${pageId} -> Archive copy ${archivePageId}; title="${title}"`,
  );
}
