/**
 * @module config/silo-router
 *
 * Silo-aware content path resolution (Decision 28). Every content path
 * core resolves goes through a silo: `siloPath(silo?, ...segments)` is
 * the one resolver used by ingest, dispatchers and plugins alike. The
 * routing functions below generalise today's `silo-router.ts` (email
 * domain, GitHub org, Slack workspace, Jira, Linear, meeting majority
 * vote) over the same `siloRouting` config, ported from
 * `jeeves-scripts-template` `src/lib/silo-router.ts` (template `main` at
 * `322054c`).
 */

import path from 'node:path';

import { loadConfig, type LoadConfigOptions } from './loader.js';
import { derivePaths } from './paths.js';
import type { Config, SiloRoutingConfig } from './schema.js';

/** Thrown by {@link siloPath} and `config check` for an unknown silo name. */
export class UnknownSiloError extends Error {
  constructor(
    public readonly silo: string,
    public readonly known: string[],
  ) {
    super(
      `Unknown silo "${silo}". Configured silos: ${known.length ? known.join(', ') : '(none)'}.`,
    );
    this.name = 'UnknownSiloError';
  }
}

const resolveDefaultBasePath = (config: Config): string =>
  config.siloRouting.defaultBasePath ?? derivePaths(config).contentDir;

/** The loaded config's resolved `siloRouting` block. */
export const siloRouting = (
  options: LoadConfigOptions = {},
): SiloRoutingConfig & { defaultBasePath: string } => {
  const config = loadConfig(options);
  return {
    ...config.siloRouting,
    defaultBasePath: resolveDefaultBasePath(config),
  };
};

/**
 * Resolve a content path under `silo` (or the default silo when omitted),
 * joining `segments` onto the silo's base path.
 *
 * @throws {@link UnknownSiloError} when `silo` is given and not configured.
 */
export const siloPath = (
  silo: string | undefined,
  segments: string[],
  options: LoadConfigOptions = {},
): string => {
  const routing = siloRouting(options);
  if (silo === undefined)
    return path.join(routing.defaultBasePath, ...segments);
  const entry = routing.silos[silo];
  if (!entry) throw new UnknownSiloError(silo, Object.keys(routing.silos));
  return path.join(entry.basePath, ...segments);
};

/** True when `silo` is configured (or omitted, meaning the default silo). */
export const isKnownSilo = (
  silo: string | undefined,
  options: LoadConfigOptions = {},
): boolean => silo === undefined || silo in siloRouting(options).silos;

export const getBasePathForEmailDomain = (
  emailDomain: string,
  options: LoadConfigOptions = {},
): string => {
  const routing = siloRouting(options);
  const domain = emailDomain.toLowerCase();
  for (const silo of Object.values(routing.silos)) {
    if (silo.emailDomains?.some((d) => d.toLowerCase() === domain)) {
      return silo.basePath;
    }
  }
  return routing.defaultBasePath;
};

export const getBasePathForGitHubOrg = (
  org: string,
  options: LoadConfigOptions = {},
): string => {
  const routing = siloRouting(options);
  const orgLower = org.toLowerCase();
  for (const silo of Object.values(routing.silos)) {
    for (const entry of silo.githubOrgs ?? []) {
      if (typeof entry === 'string') {
        if (entry.toLowerCase() === orgLower) return silo.basePath;
      } else if (entry.githubOrg.toLowerCase() === orgLower) {
        return path.join(silo.basePath, entry.relativePath);
      }
    }
  }
  return routing.defaultBasePath;
};

export const getBasePathForSlackWorkspace = (
  teamId: string,
  options: LoadConfigOptions = {},
): string => {
  const routing = siloRouting(options);
  for (const silo of Object.values(routing.silos)) {
    if (silo.slackWorkspaces?.includes(teamId)) return silo.basePath;
  }
  return routing.defaultBasePath;
};

export const getBasePathForMeeting = (
  participantEmails: string[],
  options: LoadConfigOptions = {},
): string => {
  const routing = siloRouting(options);
  const domainCounts: Record<string, number> = {};

  for (const email of participantEmails) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) continue;
    for (const [siloName, silo] of Object.entries(routing.silos)) {
      if (silo.emailDomains?.some((d) => d.toLowerCase() === domain)) {
        domainCounts[siloName] = (domainCounts[siloName] ?? 0) + 1;
      }
    }
  }

  let bestSilo: string | null = null;
  let bestCount = 0;
  let tied = false;
  for (const [siloName, count] of Object.entries(domainCounts)) {
    if (count > bestCount) {
      bestSilo = siloName;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) {
      tied = true;
    }
  }

  if (bestSilo && !tied)
    return routing.silos[bestSilo]?.basePath ?? routing.defaultBasePath;
  return routing.defaultBasePath;
};

export const getBasePathForJira = (options: LoadConfigOptions = {}): string => {
  const routing = siloRouting(options);
  for (const silo of Object.values(routing.silos)) {
    if (silo.jira) return silo.basePath;
  }
  return routing.defaultBasePath;
};

/** Base path for the silo with `linear: true`, else the default silo. */
export const getBasePathForLinear = (
  options: LoadConfigOptions = {},
): string => {
  const routing = siloRouting(options);
  for (const silo of Object.values(routing.silos)) {
    if (silo.linear) return silo.basePath;
  }
  return routing.defaultBasePath;
};

/**
 * Deduplicated entity root directories for a content subdirectory (e.g.
 * `'meetings'`) across every configured silo plus the default silo.
 */
export const getEntityDirs = (
  subdir: string,
  options: LoadConfigOptions = {},
): string[] => {
  const routing = siloRouting(options);
  const dirs = [path.join(routing.defaultBasePath, subdir)];
  for (const silo of Object.values(routing.silos)) {
    dirs.push(path.join(silo.basePath, subdir));
  }
  return [...new Set(dirs)];
};

export const getEmailBaseForAccount = (
  account: string,
  options: LoadConfigOptions = {},
): string => {
  const domain = (account || '').split('@')[1];
  if (!domain) return path.join(siloRouting(options).defaultBasePath, 'email');
  return path.join(getBasePathForEmailDomain(domain, options), 'email');
};

export const getCalendarBaseForAccount = (
  account: string,
  options: LoadConfigOptions = {},
): string => {
  const domain = (account || '').split('@')[1];
  if (!domain)
    return path.join(siloRouting(options).defaultBasePath, 'calendar');
  return path.join(getBasePathForEmailDomain(domain, options), 'calendar');
};
