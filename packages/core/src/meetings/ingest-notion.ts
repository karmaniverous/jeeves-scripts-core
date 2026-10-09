#!/usr/bin/env tsx
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

import { parseArgs, runScript } from '@karmaniverous/jeeves';

import { getRef } from '../config/index.js';
import { constants } from '../lib/constants.js';
import { notionRequest } from './lib/notion-api.js';
import { processNotionInboxMeeting } from './lib/notion-inbox-processor.js';

async function pickOldestInboxPageId(minAgeHours = 4): Promise<string | null> {
  const cutoff = new Date(
    Date.now() - minAgeHours * 60 * 60 * 1000,
  ).toISOString();
  const q = (await notionRequest(
    'POST',
    `/v1/data_sources/${getRef('notion.inboxDataSourceId')}/query`,
    {
      page_size: 1,
      filter: { timestamp: 'created_time', created_time: { before: cutoff } },
      sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
    },
  )) as { results?: Array<{ id?: string }> };
  return q.results?.[0]?.id || null;
}

async function main(): Promise<void> {
  if (!fs.existsSync(constants().NOTION_API_KEY_PATH)) {
    console.log('[skip] Notion API key not configured');
    return;
  }

  const args = parseArgs();
  const requestedPageId = args['page-id'] || args['meeting-id'];
  const minAgeHours = 'min-age' in args ? parseFloat(args['min-age']) : 4;
  const isDryRun = process.argv.includes('--dry-run');

  // Check file override
  const OVERRIDE_PATH = path.join(
    constants().CONTENT_DIR,
    '../state/temp/notion-inbox-override.txt',
  );
  let fileOverride: string | null = null;
  if (!requestedPageId && fs.existsSync(OVERRIDE_PATH)) {
    fileOverride = fs.readFileSync(OVERRIDE_PATH, 'utf8').trim();
  }

  const pageId =
    requestedPageId ||
    fileOverride ||
    (await pickOldestInboxPageId(minAgeHours));
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
    process.exit(0);
  }

  await processNotionInboxMeeting(pageId);

  if (!requestedPageId && fileOverride) {
    try {
      fs.unlinkSync(OVERRIDE_PATH);
    } catch {
      // Ignore
    }
  }
}

runScript('meetings/ingest-notion', () => {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
});
