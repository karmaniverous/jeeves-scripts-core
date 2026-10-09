#!/usr/bin/env tsx
/**
 * @module watch
 *
 * Poll GitHub notifications and escalate important items.
 *
 * Called by the jeeves-runner scheduler. Iterates over constants().GH_ACCOUNT and
 * constants().GH_BOT_USER, fetches participating notifications via the GitHub API,
 * tracks seen/changed state, and enqueues escalations for review
 * requests, mentions, and stale items. Logs runs to constants().GITHUB_DIR/watch/.
 */

import fs from 'node:fs';
import path from 'node:path';

import { nowIso, runScript } from '@karmaniverous/jeeves';
import { getRunnerClient } from '@karmaniverous/jeeves-runner';

import { constants } from '../lib/constants.js';
import { gh, setupGhConfig } from '../lib/gh.js';

setupGhConfig();

const WORKDIR = path.join(constants().GITHUB_DIR, 'watch');
const LOG_PATH = path.join(WORKDIR, 'log.md');
const STATE_NS = 'github';
const STATE_KEY_PREFIX = 'watch-';
const USERS = [constants().GH_BOT_USER, constants().GH_ACCOUNT];

const IMPORTANT_REASONS = new Set([
  'review_requested',
  'mention',
  'team_mention',
  'security_alert',
]);

interface Notification {
  id: string;
  updated_at: string;
  unread: boolean;
  reason: string;
  subject?: { title?: string; type?: string; url?: string };
  repository?: { full_name?: string; html_url?: string };
}

interface WatchState {
  seen?: Record<string, string>;
  alerts?: Record<string, Record<string, string>>;
  lastRun?: string;
  lastError?: string;
  lastErrorAt?: string;
  lastFetched?: number;
  lastImportantNew?: number;
}

function hoursSince(iso: string): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 36e5;
}

function parseNumberFromApiUrl(apiUrl: string | undefined): number | null {
  if (!apiUrl) return null;
  const m = /\/(issues|pulls)\/(\d+)(\?.*)?$/.exec(apiUrl);
  return m ? Number(m[2]) : null;
}

function bestWebUrl(n: Notification): string {
  const repoHtml = n.repository?.html_url;
  const apiUrl = n.subject?.url;
  const t = n.subject?.type;
  const num = parseNumberFromApiUrl(apiUrl);
  if (repoHtml && num && t === 'PullRequest')
    return `${repoHtml}/pull/${String(num)}`;
  if (repoHtml && num && t === 'Issue')
    return `${repoHtml}/issues/${String(num)}`;
  if (repoHtml) return repoHtml;
  return apiUrl || '';
}

function formatLine(n: Notification, extra = ''): string {
  const repo = n.repository?.full_name || 'unknown/repo';
  const title = n.subject?.title || '(no title)';
  const reason = n.reason || 'unknown';
  const url = bestWebUrl(n);
  return `\u2022 ${repo} \u2014 ${title} (${reason})${extra}${url ? `\n  ${url}` : ''}`;
}

function main(): void {
  if (!fs.existsSync(constants().GH_CONFIG_DIR)) {
    console.log('[skip] GitHub CLI config not configured');
    return;
  }

  const client = getRunnerClient();
  const alerts: Array<{
    user: string;
    type: string;
    reason: string;
    line: string;
  }> = [];
  const perUser: Record<
    string,
    { fetched: number; importantNew: number; error?: string }
  > = {};

  try {
    for (const user of USERS) {
      gh(['auth', 'switch', '-u', user]);
      const res = gh(
        [
          'api',
          '-X',
          'GET',
          '/notifications?all=true&participating=true&per_page=50',
        ],
        { allowFail: true },
      );

      const acctJson = client.getState(STATE_NS, STATE_KEY_PREFIX + user);
      const prev: WatchState = acctJson
        ? (JSON.parse(acctJson) as WatchState)
        : {};

      if (!res.ok) {
        const msg = (res.err || res.out || '').trim();
        const hrsSincePrev = prev.lastErrorAt
          ? hoursSince(prev.lastErrorAt)
          : null;
        const shouldAlert =
          msg !== prev.lastError || hrsSincePrev == null || hrsSincePrev >= 6;
        if (shouldAlert) {
          alerts.push({
            user,
            type: 'error',
            reason: 'notifications_api_failed',
            line: `\u2022 ${user} \u2014 cannot fetch notifications: ${msg}`,
          });
        }
        client.setState(
          STATE_NS,
          STATE_KEY_PREFIX + user,
          JSON.stringify({
            ...prev,
            lastRun: nowIso(),
            lastError: msg,
            lastErrorAt: nowIso(),
            lastFetched: 0,
            lastImportantNew: 0,
          }),
        );
        perUser[user] = { fetched: 0, importantNew: 0, error: msg };
        continue;
      }

      const notifs: Notification[] = res.out
        ? (JSON.parse(res.out) as Notification[])
        : [];
      const seenOut: Record<string, string> = {};
      const alertsOut: Record<string, Record<string, string>> = prev.alerts ||
      {};
      let fetched = 0,
        importantNew = 0;

      for (const n of notifs) {
        fetched++;
        const id = n.id;
        const updatedAt = n.updated_at;
        const prevUpdatedAt = prev.seen?.[id];
        const isChanged = prevUpdatedAt !== updatedAt;
        seenOut[id] = updatedAt;

        const isImportant = IMPORTANT_REASONS.has(n.reason);
        const hrs = hoursSince(updatedAt);

        if (n.unread && isImportant && isChanged) {
          importantNew++;
          const alertLine = formatLine(n);
          alerts.push({
            user,
            type: 'important',
            reason: n.reason,
            line: alertLine,
          });
          client.enqueue('github-escalations', {
            ts: nowIso(),
            jobId: 'github-watch',
            account: user,
            threadId: id,
            reason: n.reason,
            line: alertLine,
            modelAlias: 'gpt-mini',
          });
        }

        if (n.unread && n.reason === 'review_requested' && hrs != null) {
          const a =
            (alertsOut as Record<string, Record<string, string> | undefined>)[
              id
            ] ?? {};
          if (hrs >= 48 && !a['48h']) {
            a['48h'] = nowIso();
            alertsOut[id] = a;
            alerts.push({
              user,
              type: 'stale',
              reason: 'review_requested_48h',
              line: formatLine(
                n,
                ` \u2014 requested ~${String(Math.round(hrs))}h ago`,
              ),
            });
          } else if (hrs >= 96 && !a['96h']) {
            a['96h'] = nowIso();
            alertsOut[id] = a;
            alerts.push({
              user,
              type: 'stale',
              reason: 'review_requested_96h',
              line: formatLine(
                n,
                ` \u2014 requested ~${String(Math.round(hrs))}h ago`,
              ),
            });
          }
        }
      }

      client.setState(
        STATE_NS,
        STATE_KEY_PREFIX + user,
        JSON.stringify({
          seen: seenOut,
          alerts: alertsOut,
          lastRun: nowIso(),
          lastFetched: fetched,
          lastImportantNew: importantNew,
        }),
      );
      perUser[user] = { fetched, importantNew };
    }

    fs.appendFileSync(
      LOG_PATH,
      `- ${nowIso()} \u2014 fetched: ${USERS.map((u) => `${u}=${String(perUser[u].fetched)}`).join(', ')}; alerts: ${String(alerts.length)}\n`,
    );
    process.stdout.write(
      JSON.stringify({ at: nowIso(), perUser, alerts }, null, 2),
    );
  } finally {
    client.close();
  }
}

runScript('github/watch', main);
