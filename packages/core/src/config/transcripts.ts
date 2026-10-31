/**
 * @module config/transcripts
 *
 * `transcriptsConfig()`: the `transcripts` block with its defaults
 * resolved, the way `paths()` resolves path overrides: `libraryDir`
 * under the default silo (`library/video-transcripts`), `scratchDir`
 * under the state directory (`transcripts`), and `userAgent`
 * `jeeves-scripts/<instance.name>` (Decision 74). Reads the instance
 * config only.
 */

import path from 'node:path';

import { loadConfig, type LoadConfigOptions } from './loader.js';
import { derivePaths } from './paths.js';
import type { Config } from './schema.js';
import { resolveDefaultBasePath } from './silo-router.js';

/** The resolved `transcripts` block. */
export interface TranscriptsConfig {
  /** Where kept transcripts are filed. */
  libraryDir: string;
  /** Cached API responses and scratch copies. */
  scratchDir: string;
  /** The User-Agent sent to the transcript API. */
  userAgent: string;
}

/** Resolve a validated config's `transcripts` block (absent: all defaults). */
export const deriveTranscripts = (config: Config): TranscriptsConfig => {
  const block = config.transcripts ?? {};
  const { stateDir } = derivePaths(config);
  const silo = resolveDefaultBasePath(config);
  return {
    libraryDir:
      block.libraryDir ?? path.join(silo, 'library', 'video-transcripts'),
    scratchDir: block.scratchDir ?? path.join(stateDir, 'transcripts'),
    userAgent: block.userAgent ?? `jeeves-scripts/${config.instance.name}`,
  };
};

/** The loaded instance config's resolved `transcripts` block. */
export const transcriptsConfig = (
  options: LoadConfigOptions = {},
): TranscriptsConfig => deriveTranscripts(loadConfig(options));
