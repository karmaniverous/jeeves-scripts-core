/**
 * @module admin/session-refresh
 *
 * Runnable `admin-refresh-sessions`: rotates idle Slack gateway sessions
 * whose context has grown past the cache-read threshold
 * (`admin/lib/session-refresh-run`). Wires the live collaborators: OpenClaw's
 * sessions directory, the gateway, the clock and the environment
 * (`CACHE_READ_THRESHOLD`, `IDLE_MINUTES`, `EXCLUDED_SESSION_KEYS`).
 */

import crypto from 'node:crypto';

import { constants } from '../lib/constants.js';
import { gatewayInvoke } from '../lib/gateway-client.js';
import { defineRunnable } from '../runnables/define-runnable.js';
import {
  sessionRefresh,
  type SessionRefreshDeps,
  sessionRefreshSettings,
} from './lib/session-refresh-run.js';

/** The live dependencies, resolved when the job runs. */
export const sessionRefreshDeps = (): SessionRefreshDeps => ({
  sessionsDir: constants().SESSIONS_DIR,
  invoke: gatewayInvoke,
  now: Date.now,
  uuid: () => crypto.randomUUID(),
  settings: sessionRefreshSettings(process.env),
});

export default defineRunnable({
  id: 'admin-refresh-sessions',
  domain: 'admin',
  flags: {},
  name: 'session-refresh',
  run: async () => {
    await sessionRefresh(sessionRefreshDeps());
  },
});
