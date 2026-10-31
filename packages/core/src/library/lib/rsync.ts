/**
 * @module library/lib/rsync
 *
 * rsync argument construction and `--itemize-changes` parsing for the
 * library mirror (spec 2.9). On Windows, rsync is a Cygwin build
 * (cwRsync, e.g. `choco install rsync`) that reads `C:\x` as a remote
 * host, so every path argument is converted to its `/cygdrive/c/x` form
 * ({@link rsyncPath}); elsewhere paths pass through unchanged.
 */

/**
 * A local path as rsync takes it on `platform`: on `win32`, `C:\a\b` is
 * `/cygdrive/c/a/b` and `\\host\share\a` is `//host/share/a` (Cygwin's
 * forms); other backslashes become `/`. On any other platform, `p`.
 */
export const rsyncPath = (
  p: string,
  platform: NodeJS.Platform = process.platform,
): string => {
  if (platform !== 'win32') return p;
  const slashed = p.replace(/\\/g, '/');
  const drive = /^([A-Za-z]):\/*(.*)$/.exec(slashed);
  if (!drive) return slashed;
  const [, letter = '', rest = ''] = drive;
  return `/cygdrive/${letter.toLowerCase()}/${rest}`;
};

/** What {@link rsyncArgs} mirrors. */
export interface RsyncArgsOptions {
  /** Directory whose contents are mirrored (a trailing `/` is added). */
  source: string;
  /** Directory mirrored into. */
  dest: string;
  /**
   * rsync filter patterns to exclude: without `deleteExcluded`, `--delete`
   * leaves matching files in `dest` alone (protects them).
   */
  exclude: readonly string[];
  /**
   * Also delete `dest` files matching `exclude` (`--delete-excluded`), so a
   * pattern added later removes what an earlier run copied. Never for a
   * destination whose excludes protect it.
   */
  deleteExcluded?: boolean | undefined;
  /** Directory for rsync's temporary files, renamed into place. */
  tempDir?: string | undefined;
  /** Report only (`--dry-run`). */
  dryRun: boolean;
}

/**
 * The rsync argument vector for a checksum mirror of `source` into
 * `dest`: recursive, mtimes kept, content compared by checksum, extra
 * files deleted, every change itemized. Symlinks are copied as symlinks
 * only when they stay inside the tree (`--safe-links`): the source is an
 * untrusted public repo, and an absolute link or one that climbs out of
 * the tree (`x -> /etc/passwd`, `-> ../../secrets`) would let the
 * watcher or jeeves-server read host files from the content tree. A link
 * within the tree only names content that is mirrored anyway, so it is
 * kept rather than dropped (`--no-links`).
 */
export const rsyncArgs = (
  opts: RsyncArgsOptions,
  platform: NodeJS.Platform = process.platform,
): string[] => {
  const args = [
    '--recursive',
    '--links',
    '--safe-links',
    '--times',
    '--checksum',
    '--delete',
    '--itemize-changes',
  ];
  if (opts.deleteExcluded) args.push('--delete-excluded');
  if (opts.dryRun) args.push('--dry-run');
  if (opts.tempDir)
    args.push(`--temp-dir=${rsyncPath(opts.tempDir, platform)}`);
  for (const pattern of opts.exclude) args.push(`--exclude=${pattern}`);
  args.push(
    `${rsyncPath(opts.source, platform).replace(/\/+$/, '')}/`,
    rsyncPath(opts.dest, platform),
  );
  return args;
};

/** Counts of rsync `--itemize-changes` lines. */
export interface RsyncSummary {
  /** Files created or updated. */
  written: number;
  /** Paths deleted. */
  deleted: number;
  /** Directories created. */
  dirsCreated: number;
  /** Files with unchanged content whose attributes (e.g. mtime) were updated. */
  touched: number;
}

/** Count the changes in rsync `--itemize-changes` output. */
export const summarizeRsync = (output: string): RsyncSummary => {
  const summary: RsyncSummary = {
    written: 0,
    deleted: 0,
    dirsCreated: 0,
    touched: 0,
  };
  for (const line of output.split('\n')) {
    if (line.startsWith('*deleting')) summary.deleted++;
    else if (/^[<>c]f/.test(line)) summary.written++;
    else if (line.startsWith('cd')) summary.dirsCreated++;
    else if (/^\.f\S*[^.\s]/.test(line)) summary.touched++;
  }
  return summary;
};
