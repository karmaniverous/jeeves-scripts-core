/**
 * @module calendar/poll
 *
 * Polls Google Calendar events for every configured calendar account and
 * writes one JSON file per event to the silo-routed archive
 * (`{silo}/calendar/<email>/<calendar>/`), rewritten only on change
 * (`lib/calendar-store`). The window runs from a day before the last sync
 * (or {@link INITIAL_LOOKBACK_DAYS} back) to {@link FORWARD_DAYS} ahead.
 *
 * Service-account accounts (`calendar.serviceAccount: "auto"`) use the key
 * gog registered at `{GOG_CONFIG_DIR}/data/sa-<base64(email)>.json` (or,
 * for older gog builds without `data/`, in the `GOG_CONFIG_DIR` root);
 * token-file accounts need the gog OAuth client.
 *
 * No calendar accounts: skips (exit 0). Each account's own credential is
 * checked first (lib/calendar-accounts.ts); accounts missing it are
 * reported, the rest are polled, and then the run fails (exit 1).
 */

import path from 'node:path';

import type { AccountConfig } from '@karmaniverous/jeeves';
import { createGoogleAuth } from '@karmaniverous/jeeves';
import {
  getRunnerClient,
  type RunnerClient,
} from '@karmaniverous/jeeves-runner';

import {
  type AccountConfig as ConfiguredAccount,
  getBasePathForEmailDomain,
  getCalendarAccounts,
} from '../config/index.js';
import { constants } from '../lib/constants.js';
import {
  detectGogCredentials,
  findServiceAccountFile,
} from '../lib/gog-credentials.js';
import { defineRunnable } from '../runnables/define-runnable.js';
import {
  type CalendarAccountResolution,
  resolveCalendarAccounts,
} from './lib/calendar-accounts.js';
import {
  type CalendarEntry,
  type CalendarEvent,
  getAllEvents,
  listCalendars,
} from './lib/calendar-api.js';
import { sanitize, writeEvent } from './lib/calendar-store.js';

/** Days back on an account's first poll. */
export const INITIAL_LOOKBACK_DAYS = 90;
/** Days ahead of now. */
export const FORWARD_DAYS = 90;
const STATE_NAMESPACE = 'calendar';
const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
const DAY_MS = 24 * 60 * 60 * 1000;

/** What {@link pollCalendars} reads and calls. */
export interface CalendarPollDeps {
  /** The configured calendar accounts. */
  configured: () => ConfiguredAccount[];
  /** Split the accounts into those with a usable credential and problems. */
  resolve: (configured: ConfiguredAccount[]) => CalendarAccountResolution;
  /** An access token for an account. */
  accessToken: (account: AccountConfig) => Promise<string>;
  /** The account's calendars. */
  listCalendars: (token: string) => Promise<CalendarEntry[]>;
  /** A calendar's events in a window. */
  getAllEvents: (
    token: string,
    calendarId: string,
    timeMin: string,
    timeMax: string,
  ) => Promise<CalendarEvent[]>;
  /** The archive directory of an account. */
  calendarBase: (email: string) => string;
  /** Runner state (last sync per account). */
  runner: () => Pick<RunnerClient, 'getState' | 'setState' | 'close'>;
  /** Clock. */
  now: () => Date;
}

/** The live collaborators, from config. */
export const calendarPollDeps = (): CalendarPollDeps => {
  const c = constants();
  const googleAuth = createGoogleAuth({
    clientCredentialsPath: c.GOG_CLIENT_PATH,
    credentialsDir: c.CREDENTIALS_DIR,
    serviceAccountDir: c.GOG_CONFIG_DIR,
  });
  return {
    configured: getCalendarAccounts,
    resolve: (configured) =>
      resolveCalendarAccounts(configured, {
        oauthClient: detectGogCredentials().oauthClient,
        oauthClientPath: c.GOG_CLIENT_PATH,
        findServiceAccount: (email) => findServiceAccountFile(email),
      }),
    accessToken: (account) =>
      googleAuth.getAccessToken(account, CALENDAR_SCOPES),
    listCalendars,
    getAllEvents,
    calendarBase: (email) =>
      path.join(
        getBasePathForEmailDomain(email.split('@')[1] ?? ''),
        'calendar',
        email,
      ),
    runner: () => getRunnerClient(),
    now: () => new Date(),
  };
};

async function pollAccount(
  account: AccountConfig,
  client: ReturnType<CalendarPollDeps['runner']>,
  deps: CalendarPollDeps,
): Promise<void> {
  const { email } = account;
  console.log(`\n=== ${email} ===`);
  const accessToken = await deps.accessToken(account);

  const now = deps.now();
  const lastSync = client.getState(STATE_NAMESPACE, `lastSync-${email}`);
  const timeMin = lastSync
    ? new Date(new Date(lastSync).getTime() - DAY_MS).toISOString()
    : new Date(now.getTime() - INITIAL_LOOKBACK_DAYS * DAY_MS).toISOString();
  const timeMax = new Date(now.getTime() + FORWARD_DAYS * DAY_MS).toISOString();
  console.log(
    `  Time window: ${timeMin.substring(0, 10)} \u2192 ${timeMax.substring(0, 10)}`,
  );

  const calendars = await deps.listCalendars(accessToken);
  console.log(`  Found ${String(calendars.length)} calendars`);

  const calBase = deps.calendarBase(email);
  let totalEvents = 0;
  let updatedEvents = 0;
  for (const cal of calendars) {
    if (cal.accessRole === 'freeBusyReader') continue;
    try {
      const events = await deps.getAllEvents(
        accessToken,
        cal.id,
        timeMin,
        timeMax,
      );
      if (events.length === 0) continue;
      for (const event of events) {
        totalEvents++;
        if (
          writeEvent(
            calBase,
            cal.id,
            cal.summary,
            event,
            deps.now().toISOString(),
          )
        )
          updatedEvents++;
      }
      console.log(
        `  ${sanitize(cal.summary ?? cal.id)}: ${String(events.length)} events`,
      );
    } catch (e) {
      console.error(
        `  Error fetching ${cal.summary ?? cal.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  console.log(
    `  Total: ${String(totalEvents)} events, ${String(updatedEvents)} new/updated`,
  );
  client.setState(STATE_NAMESPACE, `lastSync-${email}`, now.toISOString());
}

/**
 * Poll every account with a usable credential.
 *
 * @throws After polling, when any account has no usable credential.
 */
export async function pollCalendars(deps: CalendarPollDeps): Promise<void> {
  const configured = deps.configured();
  if (configured.length === 0) {
    console.log('[skip] No calendar accounts configured');
    return;
  }
  // Each account must have its own credential: an unrelated key or
  // client does not count.
  const { accounts, problems } = deps.resolve(configured);
  for (const p of problems) console.error(`[credentials] ${p}`);

  console.log('Calendar poll started:', deps.now().toISOString());
  const client = deps.runner();
  try {
    for (const account of accounts) {
      try {
        await pollAccount(account, client, deps);
      } catch (e) {
        console.error(
          `Error polling ${account.email}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  } finally {
    client.close();
  }

  console.log('\nCalendar poll complete.');
  if (problems.length > 0)
    throw new Error(
      `calendar/poll: ${String(problems.length)} calendar account(s) have no usable gog credentials: ${problems.join('; ')}`,
    );
}

export default defineRunnable({
  id: 'calendar-poll',
  domain: 'calendar',
  flags: {},
  name: 'calendar/poll',
  run: () => pollCalendars(calendarPollDeps()),
});
