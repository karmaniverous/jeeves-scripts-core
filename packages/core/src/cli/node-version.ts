/**
 * @module cli/node-version
 *
 * The Node floor core requires (#75) and the `doctor` check against it:
 * Node 24.16-24.18 carry a node:sqlite WAL checkpoint bug that lets the
 * WAL grow without bound, fixed in 24.22.2. {@link NODE_FLOOR} matches
 * `engines.node` in core's `package.json` (a test keeps them in step).
 * Pure: no IO.
 */

/** The lowest Node version core supports; `engines.node` is `>=` this. */
export const NODE_FLOOR = '24.22.2';

/** Why {@link NODE_FLOOR} is the floor, for the `doctor` line. */
export const NODE_FLOOR_REASON =
  'Node 24.16-24.18 have a SQLite WAL checkpoint bug (the WAL grows without bound)';

/** `major.minor.patch` as numbers; a missing or non-numeric part is 0. */
const parts = (version: string): number[] =>
  version
    .replace(/^v/, '')
    .split(/[.+-]/)
    .slice(0, 3)
    .map((p) => Number.parseInt(p, 10) || 0);

/** Whether `version` is at or above `floor` (both `x.y.z`, an optional `v`). */
export const meetsFloor = (version: string, floor = NODE_FLOOR): boolean => {
  const v = parts(version);
  const f = parts(floor);
  for (let i = 0; i < 3; i++) {
    const a = v[i] ?? 0;
    const b = f[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
};

/** The `doctor` Node check: whether it passes, and its report line. */
export const nodeCheck = (
  version: string = process.versions.node,
): { ok: boolean; line: string } =>
  meetsFloor(version)
    ? { ok: true, line: `node: ${version} (requires >=${NODE_FLOOR}): OK` }
    : {
        ok: false,
        line: `node: ${version}: FAILED: requires >=${NODE_FLOOR}; ${NODE_FLOOR_REASON}. Upgrade Node.`,
      };
