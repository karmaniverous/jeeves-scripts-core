/**
 * @module slack/lib/relocate
 *
 * `jeeves-scripts slack relocate-archives` (cut-over tool): find archived
 * Slack channel directories (`{silo}/slack/{name} ({id})`) that sit in a
 * silo other than the one the current routing gives their channel
 * (channel-workspace, then `siloRouting`), and move their files there.
 *
 * - The plan is always printed; nothing moves without `--live`.
 * - Never overwrites: a file already at the target with the same bytes
 *   is merged (the source copy is dropped); different bytes are a clash.
 *   Any clash stops a live run before it moves anything.
 * - Idempotent: once moved, a directory is where routing wants it and is
 *   not planned again. Emptied source directories are removed.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { ChannelInfo } from './channel-info.js';
import { isDirectMessage } from './channel-workspace.js';

/** One channel directory to move. */
export interface RelocateMove {
  channelId: string;
  fromSilo: string;
  toSilo: string;
  from: string;
  to: string;
  /** Files (relative to the directory) to move. */
  move: string[];
  /** Files already at the target with the same bytes (source dropped). */
  merge: string[];
  /** Files at the target with different bytes. */
  clash: string[];
}

/** The relocation plan. */
export interface RelocatePlan {
  moves: RelocateMove[];
  /** Archived channel directories whose channel is unknown or has no workspace yet (left alone). */
  unknown: string[];
  totals: { dirs: number; move: number; merge: number; clash: number };
}

/** A silo's name and base path. */
export interface SiloBase {
  name: string;
  basePath: string;
}

const CHANNEL_DIR = / \(([A-Z0-9]+)\)$/;

const same = (a: string, b: string): boolean => {
  const norm = (p: string) => {
    const r = path.resolve(p);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
};

/** All files under `dir`, relative to it, sorted. */
function walk(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(dir, rel), {
    withFileTypes: true,
  })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...walk(dir, r));
    else out.push(r);
  }
  return out.sort();
}

const sameBytes = (a: string, b: string): boolean =>
  fs.readFileSync(a).equals(fs.readFileSync(b));

/** The workspace routing wants for a channel: its account's for a DM, else its cached `teamId`. */
export const targetTeam = (
  info: ChannelInfo,
  accountTeams: Record<string, string>,
): string | undefined =>
  isDirectMessage(info)
    ? (accountTeams[info._account ?? 'default'] ?? info.teamId)
    : info.teamId;

/**
 * Plan the moves.
 *
 * @param silos - Every silo (the default silo included) whose `slack/` is scanned.
 * @param basePathFor - Silo base path for a workspace (`getBasePathForSlackWorkspace`).
 */
export function planRelocation(options: {
  channels: Record<string, ChannelInfo>;
  accountTeams: Record<string, string>;
  silos: SiloBase[];
  basePathFor: (teamId: string) => string;
}): RelocatePlan {
  const { channels, accountTeams, silos, basePathFor } = options;
  const siloOf = (base: string) =>
    silos.find((s) => same(s.basePath, base))?.name ?? base;
  const plan: RelocatePlan = {
    moves: [],
    unknown: [],
    totals: { dirs: 0, move: 0, merge: 0, clash: 0 },
  };
  const scanned = new Set<string>();
  for (const silo of silos) {
    const slackRoot = path.join(silo.basePath, 'slack');
    if (scanned.has(path.resolve(slackRoot).toLowerCase())) continue;
    scanned.add(path.resolve(slackRoot).toLowerCase());
    if (!fs.existsSync(slackRoot)) continue;
    for (const e of fs.readdirSync(slackRoot, { withFileTypes: true })) {
      const id = e.isDirectory() ? CHANNEL_DIR.exec(e.name)?.[1] : undefined;
      if (!id) continue;
      const from = path.join(slackRoot, e.name);
      const info = channels[id];
      const team = info ? targetTeam(info, accountTeams) : undefined;
      if (!team) {
        plan.unknown.push(from);
        continue;
      }
      const targetBase = basePathFor(team);
      if (same(targetBase, silo.basePath)) continue;
      const targetRoot = path.join(targetBase, 'slack');
      const existing = fs.existsSync(targetRoot)
        ? fs.readdirSync(targetRoot).find((n) => n.endsWith(`(${id})`))
        : undefined;
      const to = path.join(targetRoot, existing ?? e.name);
      const move: RelocateMove = {
        channelId: id,
        fromSilo: silo.name,
        toSilo: siloOf(targetBase),
        from,
        to,
        move: [],
        merge: [],
        clash: [],
      };
      for (const rel of walk(from)) {
        const target = path.join(to, rel);
        if (!fs.existsSync(target)) move.move.push(rel);
        else if (sameBytes(path.join(from, rel), target)) move.merge.push(rel);
        else move.clash.push(rel);
      }
      plan.moves.push(move);
      plan.totals.dirs++;
      plan.totals.move += move.move.length;
      plan.totals.merge += move.merge.length;
      plan.totals.clash += move.clash.length;
    }
  }
  return plan;
}

/** Files per `fromSilo -> toSilo` route (moved + merged). */
export const planRoutes = (plan: RelocatePlan): Record<string, number> => {
  const routes: Record<string, number> = {};
  for (const m of plan.moves) {
    const k = `${m.fromSilo} -> ${m.toSilo}`;
    routes[k] = (routes[k] ?? 0) + m.move.length + m.merge.length;
  }
  return routes;
};

/** The plan as text. */
export function formatPlan(plan: RelocatePlan, live: boolean): string {
  const lines = [
    `Slack archive relocation plan (${live ? 'LIVE' : 'dry run'})`,
    `Directories to relocate: ${String(plan.totals.dirs)}; files to move: ${String(plan.totals.move)}; identical (merge): ${String(plan.totals.merge)}; clashes: ${String(plan.totals.clash)}`,
    'Files per route:',
    ...Object.entries(planRoutes(plan)).map(([r, n]) => `  ${r}: ${String(n)}`),
    '',
  ];
  for (const m of plan.moves) {
    lines.push(
      `${m.channelId}  ${m.fromSilo} -> ${m.toSilo}  move ${String(m.move.length)}, merge ${String(m.merge.length)}, clash ${String(m.clash.length)}`,
      `  from ${m.from}`,
      `  to   ${m.to}`,
      ...m.clash.map((c) => `  CLASH ${c}`),
    );
  }
  if (plan.unknown.length)
    lines.push(
      '',
      `Left alone (channel unknown or without a workspace): ${String(plan.unknown.length)}`,
      ...plan.unknown.map((u) => `  ${u}`),
    );
  return `${lines.join('\n')}\n`;
}

/** Remove `dir` and empty parents of its files, bottom-up (never `dir`'s parent). */
function removeEmpty(dir: string): void {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true }))
    if (e.isDirectory()) removeEmpty(path.join(dir, e.name));
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

/**
 * Carry out a plan. Refuses (throws, nothing moved) when it has a clash.
 * Re-checks each target before moving, so a file that appeared since
 * planning is never overwritten.
 */
export function applyRelocation(plan: RelocatePlan): void {
  if (plan.totals.clash > 0)
    throw new Error(
      `Relocation stopped: ${String(plan.totals.clash)} clash(es); resolve them first (nothing was moved).`,
    );
  for (const m of plan.moves) {
    for (const rel of m.move) {
      const src = path.join(m.from, rel);
      const dst = path.join(m.to, rel);
      if (fs.existsSync(dst))
        throw new Error(`Target appeared since planning: ${dst} (stopped).`);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      try {
        fs.renameSync(src, dst);
      } catch {
        fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
        fs.unlinkSync(src);
      }
    }
    for (const rel of m.merge) fs.unlinkSync(path.join(m.from, rel));
    removeEmpty(m.from);
  }
}
