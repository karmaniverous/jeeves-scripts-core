/**
 * @module transcripts/fetch-video
 *
 * Runnable `transcripts-fetch-video` (spec 2.10, #54), on demand only (no
 * manifest; the `jeeves-transcripts` skill invokes it): fetch a YouTube
 * video's transcript through TranscriptAPI and write it to disk, so the
 * agent never retypes or holds the whole transcript. Prints one JSON
 * line and exits 0, or 2 (usage), 3 (no captions), 4 (API or other
 * error), 5 (exists). Without `--live` it reports what it would write
 * and writes nothing. Reads `TRANSCRIPT_API_KEY` from the environment
 * (never from `jeeves-scripts.json`).
 */

import { transcriptsConfig } from '../config/transcripts.js';
import { argFlag, argOptional, positionalArgs } from '../lib/args.js';
import { defineRunnable } from '../runnables/define-runnable.js';
import { fileTranscript } from './lib/file-transcript.js';

/** The flags `transcripts-fetch-video` accepts. */
export const fetchVideoFlags = {
  keep: argFlag('--keep', 'File the transcript in the library'),
  dir: argOptional('--dir', {
    description: 'Library directory override (implies --keep)',
  }),
  out: argOptional('--out', {
    description: 'Exact output path (implies --keep)',
  }),
  force: argFlag(
    '--force',
    'Overwrite a kept file, and refetch instead of using the cache',
  ),
  live: argFlag('--live', 'Write the files (default: report only)'),
};

export default defineRunnable({
  id: 'transcripts-fetch-video',
  domain: 'transcripts',
  description:
    'Fetch a YouTube transcript through TranscriptAPI and write it to a scratch copy or the library (TRANSCRIPT_API_KEY).',
  positionals: '<video-url-or-id>',
  flags: fetchVideoFlags,
  run: async ({ args, flags }) => {
    const config = transcriptsConfig();
    const apiKey = process.env.TRANSCRIPT_API_KEY;
    const { code, report } = await fileTranscript(
      { positionals: positionalArgs(args, fetchVideoFlags), ...flags },
      {
        dirs: config,
        userAgent: config.userAgent,
        apiKey,
        fetch: globalThis.fetch,
        now: () => new Date(),
      },
    );
    console.log(JSON.stringify(report));
    if (code !== 0) process.exitCode = code;
  },
});
