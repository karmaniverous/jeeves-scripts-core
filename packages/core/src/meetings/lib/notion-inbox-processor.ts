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
  type ExtractedContent,
  extractFromPublicPage,
} from './notion-browser-extract.js';

// ── Constants ──────────────────────────────────────────────────────────

const MEETINGS_INDEX_PATH = path.join(
  constants().DEFAULT_MEETINGS_DIR,
  'index.json',
);

// ── Types ──────────────────────────────────────────────────────────────

interface NotionPage {
  id: string;
  created_time: string;
  public_url?: string;
  properties?: {
    Meeting?: { title?: Array<{ plain_text: string }> };
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
  sources: Array<{ kind: string; pageId: string; url: string }>;
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

export function chunkText(s: string, max = 1200): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    out.push(s.slice(i, i + max));
    i += max;
  }
  return out;
}

// ── Notion block helpers ───────────────────────────────────────────────

interface NotionBlock {
  object: string;
  type: string;
  [key: string]: unknown;
}

function paragraphBlock(text: string): NotionBlock {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: text } }] },
  };
}

function headingBlock(text: string, level: 1 | 2 | 3 = 2): NotionBlock {
  const type =
    level === 1 ? 'heading_1' : level === 3 ? 'heading_3' : 'heading_2';
  return {
    object: 'block',
    type,
    [type]: { rich_text: [{ type: 'text', text: { content: text } }] },
  };
}

async function appendBlocks(
  blockId: string,
  blocks: NotionBlock[],
): Promise<void> {
  const batchSize = 50;
  for (let i = 0; i < blocks.length; i += batchSize) {
    const slice = blocks.slice(i, i + batchSize);
    await notionRequest('PATCH', `/v1/blocks/${blockId}/children`, {
      children: slice,
    });
  }
}

// ── Index helpers ──────────────────────────────────────────────────────

function upsertMeetingsIndex(
  meetingId: string,
  entry: MeetingIndexEntry,
): void {
  let idx: MeetingsIndex = {
    meetings: {},
    updatedAt: new Date().toISOString(),
  };
  try {
    idx = JSON.parse(
      fs.readFileSync(MEETINGS_INDEX_PATH, 'utf8'),
    ) as MeetingsIndex;
  } catch {
    // ignore
  }
  idx.meetings[meetingId] = { ...idx.meetings[meetingId], ...entry };
  idx.updatedAt = new Date().toISOString();
  fs.writeFileSync(MEETINGS_INDEX_PATH, JSON.stringify(idx, null, 2));
}

// ── Main processor ─────────────────────────────────────────────────────

export async function processNotionInboxMeeting(pageId: string): Promise<void> {
  const page = (await notionRequest(
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

  const extracted: ExtractedContent = await extractFromPublicPage(publicUrl);

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
  const meetingDir = path.join(constants().DEFAULT_MEETINGS_DIR, meetingId);
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
    ingestedAt: new Date().toISOString(),
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

  upsertMeetingsIndex(meetingId, {
    title,
    normalizedTitle: title.toLowerCase(),
    date: createdTime.slice(0, 10),
    participantCount: 0,
    sourceCount: 1,
    artifactCount: 3,
    updatedAt: new Date().toISOString(),
    hasTranscript,
  });

  // Archive copy + Inbox archive only after successful local staging
  const archivePage = (await notionRequest('POST', '/v1/pages', {
    parent: { database_id: getRef('notion.archiveDatabaseId') },
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

  await appendBlocks(archivePageId, blocks);
  await notionRequest('PATCH', `/v1/pages/${pageId}`, { archived: true });

  console.log(
    `Processed meeting ${meetingId} from Inbox page ${pageId} -> Archive copy ${archivePageId}; title="${title}"`,
  );
}
