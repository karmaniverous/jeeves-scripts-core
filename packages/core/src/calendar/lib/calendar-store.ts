/**
 * @module calendar/lib/calendar-store
 *
 * The calendar archive: one JSON file per event under
 * `{base}/<calendar>/<eventId>.json`, rewritten only when the event's
 * significant fields change (SHA-256 hash). File I/O only.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { ensureDir } from '@karmaniverous/jeeves';

import { type CalendarEvent, eventPeopleField } from './calendar-api.js';

/** A calendar or file name made safe for the filesystem (at most 100 chars). */
export function sanitize(s: string): string {
  return (s || 'unknown')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);
}

/** Hash of the fields whose change rewrites an event file. */
export function eventHash(event: CalendarEvent): string {
  const significant = {
    summary: event.summary,
    description: event.description,
    start: event.start,
    end: event.end,
    location: event.location,
    status: event.status,
    attendees: (event.attendees ?? []).map((a) => ({
      email: a.email,
      responseStatus: a.responseStatus,
    })),
    recurrence: event.recurrence,
    updated: event.updated,
  };
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(significant))
    .digest('hex')
    .substring(0, 16);
}

/**
 * Write an event unless the stored copy has the same hash.
 *
 * @returns Whether the file was written.
 */
export function writeEvent(
  calBase: string,
  calendarId: string,
  calendarSummary: string | undefined,
  event: CalendarEvent,
  ingestedAt: string,
): boolean {
  const calDir = path.join(calBase, sanitize(calendarSummary ?? calendarId));
  ensureDir(calDir);
  const eventPath = path.join(calDir, `${event.id}.json`);
  const stored = {
    _calendarId: calendarId,
    _calendarSummary: calendarSummary,
    _ingestedAt: ingestedAt,
    _hash: eventHash(event),
    ...eventPeopleField(event),
    ...event,
  };
  if (fs.existsSync(eventPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(eventPath, 'utf8')) as {
        _hash?: string;
      };
      if (existing._hash === stored._hash) return false;
    } catch {
      // Corrupted file, overwrite
    }
  }
  fs.writeFileSync(eventPath, JSON.stringify(stored, null, 2) + '\n', 'utf8');
  return true;
}
