/**
 * @module transcripts/lib/paths
 *
 * Where `transcripts-fetch-video` reads and writes: the cached API
 * response (`{scratchDir}/<video_id>.json`), and the transcript itself,
 * a scratch copy (`{scratchDir}/<video_id>.md`) unless it is kept (in
 * `--dir` or the library directory as `<title-slug>-<author-slug>.md`, or
 * exactly at `--out`). Pure.
 */

import { join, resolve } from 'node:path';

/** Where transcripts go, from the resolved `transcripts` config. */
export interface TranscriptDirs {
  /** Kept transcripts. */
  libraryDir: string;
  /** Cached responses and scratch copies. */
  scratchDir: string;
}

/** Where the transcript is filed, from the flags. */
export interface TargetFlags {
  /** File it in the library (implied by `dir` or `out`). */
  keep: boolean;
  /** Library directory override. */
  dir?: string | undefined;
  /** Exact output path. */
  out?: string | undefined;
}

/** The cached response for a video. */
export const cachePath = (scratchDir: string, videoId: string): string =>
  join(scratchDir, `${videoId}.json`);

/** Whether the transcript is kept: `--keep`, `--dir` or `--out`. */
export const isKept = ({ keep, dir, out }: TargetFlags): boolean =>
  keep || dir !== undefined || out !== undefined;

/**
 * The transcript's path: the scratch copy, or the kept file.
 *
 * @param keptName - The kept file's name (`<title-slug>-<author-slug>.md`).
 */
export const targetPath = (
  flags: TargetFlags,
  dirs: TranscriptDirs,
  videoId: string,
  keptName: string,
): string =>
  isKept(flags)
    ? resolve(flags.out ?? join(flags.dir ?? dirs.libraryDir, keptName))
    : join(dirs.scratchDir, `${videoId}.md`);
