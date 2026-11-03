/**
 * @module admin/skill-review/snapshot
 *
 * Write the gathered proposals and inventory to a run directory, so the
 * worker reads files instead of a giant TASK (layout and texts from
 * `snapshot-render`):
 *
 * - `INDEX.md`: every proposal with the script's checks, then the
 *   inventory table (name, origin, bytes, description, snapshot file);
 * - `snapshot.json`: the same data, machine-readable (no file texts);
 * - `proposals/<id>/`: each artifact as drafted, plus `LIVE-SKILL.md`
 *   (the live skill an update targets);
 * - `inventory/<origin>/<name>.md`: every inventory SKILL.md.
 *
 * An artifact path that would land outside its proposal directory
 * (absolute or `..`) fails the write, whatever source supplied it.
 *
 * Run directories (`<root>/<YYYYMMDD-HHMMSS>`) and pruning are in
 * `lib/run-dirs`.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { InventorySkill } from './inventory.js';
import { containedPath } from './skill-fs.js';
import {
  type CheckedProposal,
  placeInventory,
  renderIndex,
  renderJson,
  safeName,
} from './snapshot-render.js';

/** Where a snapshot was written. */
export interface SnapshotFiles {
  /** The run directory. */
  runDir: string;
  /** `INDEX.md`. */
  indexFile: string;
  /** Where the worker writes its report. */
  reportFile: string;
}

const write = (file: string, text: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
};

/**
 * Write a snapshot.
 *
 * @param runDir - The run directory (created).
 * @param proposals - Proposals with checks.
 * @param inventory - The skill inventory (stored at the paths
 *   `placeInventory` gives).
 * @returns The files written.
 * @throws Error when an artifact path would leave its proposal directory.
 */
export function writeSnapshot(
  runDir: string,
  proposals: readonly CheckedProposal[],
  inventory: readonly InventorySkill[],
): SnapshotFiles {
  const placed = placeInventory(inventory);
  for (const { proposal: p, checks: c } of proposals) {
    const dir = path.join(runDir, 'proposals', safeName(p.id));
    for (const a of p.artifacts) {
      if (a.content === undefined) continue;
      const file = containedPath(dir, a.path);
      if (file === undefined)
        throw new Error(`${p.id}: unsafe artifact path ${a.path}`);
      write(file, a.content);
    }
    const live = inventory.find((s) => s.file === c.liveSkillFile);
    if (live) write(path.join(dir, 'LIVE-SKILL.md'), live.text);
  }
  for (const { skill, snapshotFile } of placed)
    write(path.join(runDir, snapshotFile), skill.text);
  const indexFile = path.join(runDir, 'INDEX.md');
  write(indexFile, renderIndex(proposals, placed));
  write(path.join(runDir, 'snapshot.json'), renderJson(proposals, placed));
  return { runDir, indexFile, reportFile: path.join(runDir, 'report.md') };
}
