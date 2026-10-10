#!/usr/bin/env tsx
/**
 * @module extract
 *
 * Scans the email cache for meeting-related threads and creates meeting packages.
 *
 * Called by the runner as a top-level entry point. For each configured email
 * account (via {@link getEmailAccounts}), reads cached threads from the account
 * silo (via {@link getEmailBaseForAccount}), detects meetings, extracts
 * participants and Gemini doc links, and writes per-meeting package directories.
 * Gemini transcripts are not fetched here: the package gets `gemini_link.txt`
 * and `fetch-notes` exports the Doc as the meeting's source mailbox.
 *
 * For each new meeting it enqueues the `meeting` label (and an archive when
 * the message is in the inbox and not `watch`ed, unless
 * `emailConfig.meetings.archive` is false) on `email-updates` through
 * label-actions, so nothing is enqueued when `emailConfig.reportOnly` is
 * true. Those actions are deferred, not dropped: the meeting is recorded as
 * pending, and once reportOnly is off each run catches up to
 * `CATCH_UP_PER_RUN` pending meetings using the messages' current labels
 * (see lib/pending-actions.ts).
 */

import { nowIso, runScript } from '@karmaniverous/jeeves';
import { getRunnerClient } from '@karmaniverous/jeeves-runner';

import { getEmailAccounts, pipeline } from '../config/index.js';
import {
  detectFathomFromBodies,
  detectMeetingSource,
  extractParticipants,
  findGeminiLink,
  generateMeetingId,
  normalizeMeetingTitle,
  parseDateToYmd,
} from './lib/detect.js';
import { loadArchiveMessage, scanCache } from './lib/extract-candidates.js';
import { type MeetingData, updateMeetingPackage } from './lib/package.js';
import {
  catchUpMeetingEmailActions,
  handleNewMeetingEmailActions,
  messageKey,
} from './lib/pending-actions.js';

function main(): void {
  let accounts: string[];
  let reportOnly: boolean;
  let archiveMeetingEmails: boolean;
  try {
    accounts = getEmailAccounts();
    const { emailConfig } = pipeline();
    reportOnly = emailConfig.reportOnly;
    archiveMeetingEmails = emailConfig.meetings?.archive ?? true;
  } catch {
    console.log(
      '[skip] Meeting extraction not configured \u2014 no valid pipeline block in jeeves-scripts.json',
    );
    return;
  }

  if (accounts.length === 0) {
    console.log(
      '[skip] Meeting extraction not configured \u2014 no email accounts with emailPolling enabled',
    );
    return;
  }

  if (reportOnly)
    console.log(
      '[meetings] reportOnly: Gmail label actions deferred, not enqueued',
    );
  else if (!archiveMeetingEmails)
    console.log('[meetings] emailConfig.meetings.archive is false: label only');

  const client = getRunnerClient();

  let scanned = 0,
    discovered = 0,
    added = 0,
    skipped = 0,
    queued = 0,
    deferred = 0;
  // Current labels of every candidate message, for the reportOnly catch-up.
  const currentLabels = new Map<string, string[]>();

  try {
    for (const account of accounts) {
      console.log(`[meetings] Scanning cache: ${account}`);

      const candidates = scanCache(account);
      scanned += candidates.length;
      for (const c of candidates) currentLabels.set(messageKey(c), c.labels);

      for (const c of candidates) {
        discovered++;

        // Load archive content early so we can pass it to detection
        const archive = loadArchiveMessage(account, c.threadId, c.messageId);
        const bodyText = archive?.body?.text ?? '';
        const bodyHtml = archive?.body?.html ?? '';

        // URL-based detection with body content (spec section 5)
        const source = detectMeetingSource(
          c.from,
          c.subject,
          bodyText,
          bodyHtml,
        );
        const sourceKey = `${source}:${c.threadId}:${c.messageId}`;

        if (client.hasItem('meetings', 'processedThreads', sourceKey)) {
          skipped++;
          continue;
        }

        if (!bodyText && !bodyHtml && !archive) {
          console.log(
            `[meetings] SKIP ${c.threadId}/${c.messageId} — not yet in archive`,
          );
          skipped++;
          continue;
        }

        if (source === 'not-meeting') {
          skipped++;
          client.setItem(
            'meetings',
            'processedThreads',
            `not-meeting:${c.threadId}:${c.messageId}`,
            nowIso(),
          );
          continue;
        }

        const meetingDate = parseDateToYmd(c.date, c.internalDateMs);
        const participants = extractParticipants(bodyText || bodyHtml, c.from);
        const normalizedTitle = normalizeMeetingTitle(c.subject);
        const meetingId = generateMeetingId(
          c.subject,
          meetingDate,
          participants,
        );

        // The Doc itself is fetched later by fetch-notes, as the meeting's
        // source mailbox; extraction only records the link.
        const geminiLink = findGeminiLink(bodyText) ?? findGeminiLink(bodyHtml);

        // Fathom URL detection + link capture
        const fathomDetection = detectFathomFromBodies(bodyText, bodyHtml);

        const meeting: MeetingData = {
          meetingId,
          account,
          threadId: c.threadId,
          messageId: c.messageId,
          subject: c.subject,
          normalizedTitle,
          meetingDate,
          source,
          from: c.from,
          participants,
          geminiLink,
          bodyText,
          bodyHtml,
          extractedAt: nowIso(),
          internalDateMs: c.internalDateMs,
          ...(fathomDetection
            ? {
                fathomKind: fathomDetection.kind,
                fathomUrl: fathomDetection.url,
              }
            : {}),
        };

        const result = updateMeetingPackage(meeting, client);

        if (result.isNew) {
          console.log(
            `[meetings] ADDED ${meetingId} [${source}] ${normalizedTitle.slice(0, 60)}`,
          );
          added++;

          // `meeting` label (+ archive if enabled, in inbox and not watched).
          // Under reportOnly they are deferred for a later catch-up.
          const handled = handleNewMeetingEmailActions(client, sourceKey, c, {
            reportOnly,
            archive: archiveMeetingEmails,
          });
          queued += handled.queued;
          if (handled.deferred) deferred++;
        } else {
          skipped++;
        }

        // Mark processed regardless
        client.setItem('meetings', 'processedThreads', sourceKey, nowIso());
      }
    }

    if (!reportOnly) {
      const catchUp = catchUpMeetingEmailActions(client, currentLabels, {
        archive: archiveMeetingEmails,
      });
      queued += catchUp.queued;
      if (catchUp.caughtUp > 0 || catchUp.remaining > 0)
        console.log(
          `[meetings] reportOnly catch-up: ${String(catchUp.caughtUp)} meetings, ${String(catchUp.queued)} actions queued, ${String(catchUp.remaining)} still pending`,
        );
      if (catchUp.invalid.length)
        console.warn(
          `[meetings] WARNING: ${String(catchUp.invalid.length)} unreadable pending record(s) moved to meetings/pendingEmailActionsInvalid: ${catchUp.invalid.join(', ')}`,
        );
    }

    // Save state
    client.setState(
      'meetings',
      'extract-state',
      JSON.stringify({ lastRunAt: nowIso() }),
    );

    const totalMeetings = client.countItems('meetings', 'index');
    console.log(
      `[meetings] Done: scanned=${String(scanned)} discovered=${String(discovered)} added=${String(added)} skipped=${String(skipped)} queued=${String(queued)} deferred=${String(deferred)}`,
    );
    console.log(
      `[meetings] Index: ${String(totalMeetings)} meetings total (runner state)`,
    );
  } finally {
    client.close();
  }
}

runScript('meetings/extract', main);
