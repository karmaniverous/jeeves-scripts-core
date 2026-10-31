/**
 * @module punch-list/runtime
 *
 * What both punch-list runnables share at run time: the opt-in check (no
 * `punchList` block skips), the injectable dependencies every run needs
 * (Slack, the clock, a log) and their live wiring, and "today" for a run
 * (the day in the configured zone, the store options, the server's link
 * settings and today's file URL). Reads the jeeves-server config.
 */

import type { PunchListConfig } from './config.js';
import { dayIn } from './dates.js';
import { browseUrl, readServerLinks, type ServerLinks } from './links.js';
import { liveSlack, type SlackPort } from './slack.js';
import { dayFile, type StoreOptions } from './store.js';

/** The `[skip]` reason when the instance config has no `punchList` block. */
export const NO_PUNCH_LIST = 'no punchList block in the instance config';

/** `true` when the block is configured; else the reason both runnables skip. */
export const punchListPrerequisite = (
  config: PunchListConfig | undefined,
): true | string => (config ? true : NO_PUNCH_LIST);

/** Dependencies every run takes. */
export interface JobDeps {
  /** The Slack port (created on first use). */
  slack: () => SlackPort;
  /** The current time. */
  now: () => Date;
  /** Logs one line; the live log prefixes the runnable id. */
  log: (message: string) => void;
}

/** The live dependencies for runnable `jobId`. */
export const liveJobDeps = (
  config: PunchListConfig,
  jobId: string,
  write: (line: string) => void = (line) => {
    console.log(line);
  },
): JobDeps => ({
  slack: () => liveSlack(config.slack.account),
  now: () => new Date(),
  log: (message) => {
    write(`[${jobId}] ${message}`);
  },
});

/** Today, for one run. */
export interface Today {
  /** `YYYY-MM-DD` in the configured zone. */
  day: string;
  /** The store options for today's file. */
  store: StoreOptions;
  /** The jeeves-server link settings. */
  links: ServerLinks;
  /** jeeves-server URL of today's file. */
  url: string | undefined;
}

/** Resolve today for a run starting at `now`. */
export const todayFor = (config: PunchListConfig, now: Date): Today => {
  const day = dayIn(config.timeZone, now);
  const links = readServerLinks(config.serverConfig);
  return {
    day,
    store: {
      dir: config.dir,
      today: day,
      retentionDays: config.retentionDays,
      lockFile: config.lockFile,
    },
    links,
    url: browseUrl(links, dayFile(config.dir, day)),
  };
};
