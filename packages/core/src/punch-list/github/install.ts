/**
 * @module punch-list/github/install
 *
 * Install status: is every release a Done milestone
 * ships installed here? A release tag is `component/version` (monorepos)
 * or `version` / `vversion`; the install map says where that component's
 * `package.json` lives. A scripts-repo PR is installed once its merge
 * commit is in the deployed clone's HEAD. Best effort: an unmapped
 * component is reported, not guessed.
 */

import { spawnSync } from 'node:child_process';
import { globSync, readFileSync } from 'node:fs';

import { z } from 'zod';

import { expandPath, type InstallTarget } from '../config.js';
import { STATUS_PREFIX } from '../model/lines.js';
import { type MilestoneFacts, shipOf } from './facts.js';

export type InstallState = 'installed' | 'pending' | 'unmapped';

export interface InstallCheck {
  label: string;
  state: InstallState;
  detail?: string;
}

/** Reads the environment; injectable for tests. */
export interface InstallEnv {
  /** Versions found at a `package.json` glob. */
  versionsAt: (glob: string) => string[];
  /** Whether `sha` is in `clone`'s HEAD. */
  inHead: (clone: string, sha: string) => boolean;
}

const pkgSchema = z.object({ version: z.string() });

export const liveInstallEnv: InstallEnv = {
  versionsAt: (glob) =>
    globSync(expandPath(glob)).map(
      (f) => pkgSchema.parse(JSON.parse(readFileSync(f, 'utf8'))).version,
    ),
  inHead: (clone, sha) =>
    spawnSync('git', ['-C', clone, 'merge-base', '--is-ancestor', sha, 'HEAD'])
      .status === 0,
};

/** Split a release tag into component and version. */
export const parseTag = (
  tag: string,
): { component: string; version: string } => {
  const slash = tag.lastIndexOf('/');
  const component = slash >= 0 ? tag.slice(0, slash) : '';
  const version = (slash >= 0 ? tag.slice(slash + 1) : tag).replace(/^v/, '');
  return { component, version };
};

const parts = (v: string): number[] =>
  v
    .split(/[.+-]/)
    .slice(0, 3)
    .map((n) => Number.parseInt(n, 10) || 0);

/** Whether semver `a` is at least `b` (major.minor.patch only). */
export const versionAtLeast = (a: string, b: string): boolean => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    const [p, q] = [x[i] ?? 0, y[i] ?? 0];
    if (p !== q) return p > q;
  }
  return true;
};

/** Check each release and scripts PR of a milestone. */
export const checkInstall = (
  facts: MilestoneFacts,
  installMap: Record<string, InstallTarget[]>,
  scriptsClone: string,
  env: InstallEnv = liveInstallEnv,
): InstallCheck[] =>
  facts.issues.flatMap((f): InstallCheck[] => {
    if (f.outcome === 'merged-pr' && f.pr?.mergeCommit) {
      return [
        {
          label: shipOf(f)?.label ?? '',
          state: env.inHead(scriptsClone, f.pr.mergeCommit.oid)
            ? 'installed'
            : 'pending',
        },
      ];
    }
    if (f.outcome !== 'released' || !f.release) return [];
    const { component, version } = parseTag(f.release.tag_name);
    const label = shipOf(f)?.label ?? f.release.tag_name;
    const targets = (installMap[f.repo] ?? []).filter(
      (t) => t.component === component,
    );
    if (!targets.length) return [{ label, state: 'unmapped' }];
    const found = targets.flatMap((t) => env.versionsAt(t.packageJson));
    const ok = found.some((v) => versionAtLeast(v, version));
    return [
      {
        label,
        state: ok ? 'installed' : 'pending',
        detail: found.length
          ? `installed ${found.join(', ')}`
          : 'not installed',
      },
    ];
  });

/** Installed only when every check is. */
export const allInstalled = (checks: InstallCheck[]): boolean =>
  checks.length > 0 && checks.every((c) => c.state === 'installed');

/** The Installed line once everything is installed. */
export const INSTALLED_OK = `${STATUS_PREFIX.installed}✅`;

/** `- Installed: …` */
export const installedLine = (checks: InstallCheck[]): string => {
  if (allInstalled(checks)) return INSTALLED_OK;
  const waiting = checks
    .filter((c) => c.state !== 'installed')
    .map((c) =>
      c.state === 'unmapped'
        ? `${c.label} ❔ not in the install map`
        : `${c.label} (${c.detail ?? 'not deployed'})`,
    );
  return `${STATUS_PREFIX.installed}⏳ awaiting operator update: ${waiting.join(' · ') || 'nothing released'}`;
};
