#!/usr/bin/env tsx
/**
 * @module poll
 *
 * Unified email poller — dispatches by account type. Accounts without an
 * `imap` block are polled via the gog CLI (Gmail via OAuth client or
 * service-account mailboxes). Accounts with an
 * `imap` block are polled via direct IMAP connection.
 *
 * Called on a schedule as an entry-point script. For gog accounts: searches
 * via `gog gmail search`, runs triage classification, enqueues for download
 * (google-workspace/gog-poll.ts).
 * For IMAP accounts: connects, fetches, parses MIME, writes directly to disk.
 * Trims old JSONL logs after 7 days (trim-jsonl.ts).
 *
 * Depends on constants().EMAIL_EVENTS_DIR, emailConfig.reportOnly, and bucket domain
 * config from the `pipeline` block. Missing config causes classification to
 * return null buckets (labels skipped). When reportOnly is true, threads
 * are still ingested but no Gmail label actions (classification or
 * curation-signal) are enqueued. Search output is schema-validated by
 * google-workspace/gmail-search.ts. gog
 * accounts work with an OAuth client or service-account mailboxes; if
 * gog accounts are configured and neither exists, the run fails.
 */

import path from 'node:path';

import {
  appendJsonl,
  ensureDir,
  nowIso,
  runScript,
} from '@karmaniverous/jeeves';
import {
  getRunnerClient,
  type RunnerClient,
} from '@karmaniverous/jeeves-runner';

import { type AccountConfig, pipeline } from '../config/index.js';
import { constants } from '../lib/constants.js';
import { requireGogCredentials } from '../lib/gog-credentials.js';
import { pollGogAccount } from './google-workspace/gog-poll.js';
import { pollImapAccount } from './imap/poll.js';
import { trimJsonlFiles } from './trim-jsonl.js';

/** Poll each IMAP account, logging a run line per account; errors are logged, not thrown. */
async function pollImapAccounts(
  accounts: readonly AccountConfig[],
  client: RunnerClient,
): Promise<void> {
  for (const account of accounts) {
    console.log(`[imap] Polling ${account.email}`);
    try {
      const s = await pollImapAccount(account, client);
      appendJsonl(
        path.join(constants().EMAIL_EVENTS_DIR, '_runs-imap-poll.jsonl'),
        {
          at: nowIso(),
          kind: 'imap-poll',
          account: account.email,
          fetched: s.fetched,
          written: s.written,
          skipped: s.skipped,
          failed: s.failed,
          folders: s.folders,
        },
      );
    } catch (e) {
      console.error(
        `[imap] ${account.email} error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const config = pipeline();
  const allAccounts = config.accounts.filter((a) => a.emailPolling);
  const gogAccounts = allAccounts.filter((a) => !a.imap);
  const imapAccounts = allAccounts.filter((a) => a.imap);

  const reportOnly = config.emailConfig.reportOnly;
  const client = getRunnerClient();

  try {
    ensureDir(constants().EMAIL_EVENTS_DIR);

    await pollImapAccounts(imapAccounts, client);

    // Throws (failed run) when Gmail accounts exist but gog has neither
    // an OAuth client nor service-account mailboxes.
    const hasGog = requireGogCredentials('email/poll', gogAccounts.length);
    if (reportOnly && hasGog) {
      console.log('[gog] reportOnly: no Gmail label actions will be enqueued');
    }

    for (const acctCfg of hasGog ? gogAccounts : [])
      pollGogAccount({
        account: acctCfg.email,
        client,
        reportOnly,
        query: 'in:anywhere',
        max: 100,
      });

    trimJsonlFiles(constants().EMAIL_EVENTS_DIR, 7);
  } finally {
    client.close();
  }
}

runScript('email/poll', main, constants().EMAIL_EVENTS_DIR);
