/**
 * @module migration-args
 *
 * Shared CLI argument parsing for migration scripts. Provides
 * --live (default dry-run) and --max=N (capped batch size).
 */

export interface MigrationArgs {
  live: boolean;
  max: number;
}

/** Parse migration CLI args from argv (typically process.argv.slice(2)). */
export function parseMigrationArgs(
  argv: string[],
  defaultMax = 50,
): MigrationArgs {
  let max = defaultMax;
  for (const arg of argv) {
    const m = /^--max=(\d+)$/.exec(arg);
    if (m) max = Number(m[1]);
  }
  return {
    live: argv.includes('--live'),
    max,
  };
}
