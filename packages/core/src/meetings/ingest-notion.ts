/**
 * @module ingest-notion
 *
 * Ingests meeting records from a Notion inbox database into local meeting packages.
 *
 * Called by the runner as a top-level entry point. Queries the Notion API
 * (authenticated via `constants().NOTION_API_KEY_PATH`, versioned by {@link NOTION_VERSION})
 * and delegates each inbox item to {@link processNotionInboxMeeting}.
 */

import fs from 'node:fs';
import path from 'node:path';

import { argFlag, argOptional, type ParsedArgs } from '@karmaniverous/jeeves';

import { getRef } from '../config/index.js';
import { constants } from '../lib/constants.js';
import { defineRunnable } from '../runnables/define-runnable.js';
import { notionRequest } from './lib/notion-api.js';
import { processNotionInboxMeeting } from './lib/notion-inbox-processor.js';

/** What {@link ingestNotion} reads and calls. */
export interface IngestNotionDeps {
  /** `NOTION_API_KEY_PATH`; the job skips when it does not exist. */
  apiKeyPath: string;
  /** The override file naming a page to process next. */
  overridePath: string;
  /** The Inbox data source id (`notion.inboxDataSourceId` ref). */
  inboxDataSourceId: () => string;
  /** Notion REST call. */
  request: (method: string, path: string, body: unknown) => Promise<unknown>;
  /** Process one Inbox page. */
  process: (pageId: string) => Promise<void>;
  /** Clock (ms). */
  now: () => number;
}

/** The live collaborators, from config. */
export const ingestNotionDeps = (): IngestNotionDeps => ({
  apiKeyPath: constants().NOTION_API_KEY_PATH,
  overridePath: path.join(
    constants().CONTENT_DIR,
    '../state/temp/notion-inbox-override.txt',
  ),
  inboxDataSourceId: () => getRef('notion.inboxDataSourceId'),
  request: notionRequest,
  process: (pageId) => processNotionInboxMeeting(pageId),
  now: Date.now,
});

async function pickOldestInboxPageId(
  minAgeHours: number,
  deps: IngestNotionDeps,
): Promise<string | null> {
  const cutoff = new Date(
    deps.now() - minAgeHours * 60 * 60 * 1000,
  ).toISOString();
  const q = (await deps.request(
    'POST',
    `/v1/data_sources/${deps.inboxDataSourceId()}/query`,
    {
      page_size: 1,
      filter: { timestamp: 'created_time', created_time: { before: cutoff } },
      sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
    },
  )) as { results?: { id?: string }[] };
  return q.results?.[0]?.id ?? null;
}

/** The flags `meetings-ingest-notion` accepts. */
export const ingestNotionFlags = {
  pageId: argOptional('--page-id', { description: 'Ingest this Notion page' }),
  meetingId: argOptional('--meeting-id', { description: 'Alias of --page-id' }),
  minAge: argOptional('--min-age', {
    description: 'Minimum page age in hours (default 4)',
  }),
  dryRun: argFlag('--dry-run', 'Report; write nothing'),
};

/**
 * Process the requested Inbox page (`--page-id=`/`--meeting-id=`), the
 * override file's page, or the oldest page older than `--min-age=` hours
 * (default 4); `--dry-run` prints the task instead.
 */
export async function ingestNotion(
  flags: ParsedArgs<typeof ingestNotionFlags>,
  deps: IngestNotionDeps,
): Promise<void> {
  if (!fs.existsSync(deps.apiKeyPath)) {
    console.log('[skip] Notion API key not configured');
    return;
  }

  const requestedPageId = flags.pageId ?? flags.meetingId;
  const minAgeHours = flags.minAge === undefined ? 4 : parseFloat(flags.minAge);
  const isDryRun = flags.dryRun;

  // Check file override
  const OVERRIDE_PATH = deps.overridePath;
  let fileOverride: string | null = null;
  if (!requestedPageId && fs.existsSync(OVERRIDE_PATH)) {
    fileOverride = fs.readFileSync(OVERRIDE_PATH, 'utf8').trim();
  }

  const pageId =
    requestedPageId ??
    fileOverride ??
    (await pickOldestInboxPageId(minAgeHours, deps));
  if (!pageId) {
    if (isDryRun)
      console.log(
        JSON.stringify({
          skip: true,
          reason: `No inbox meetings found (older than ${String(minAgeHours)}h)`,
        }),
      );
    else
      console.log(
        `No inbox meetings found (older than ${String(minAgeHours)}h).`,
      );
    return;
  }

  if (isDryRun) {
    console.log(
      JSON.stringify({
        task: `Process Notion inbox meeting page ${pageId}`,
        label: `ingest-notion-inbox-${pageId}`,
        thinking: 'none',
        timeout: 300,
      }),
    );
    return;
  }

  await deps.process(pageId);

  if (!requestedPageId && fileOverride) {
    try {
      fs.unlinkSync(OVERRIDE_PATH);
    } catch {
      // Ignore
    }
  }
}

export default defineRunnable({
  id: 'meetings-ingest-notion',
  domain: 'meetings',
  name: 'meetings/ingest-notion',
  flags: ingestNotionFlags,
  run: ({ flags }) => ingestNotion(flags, ingestNotionDeps()),
});
