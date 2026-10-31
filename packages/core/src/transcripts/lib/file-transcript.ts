/**
 * @module transcripts/lib/file-transcript
 *
 * The body of `transcripts-fetch-video` (spec 2.10, #54): parse the video,
 * reuse the cached API response or fetch one from TranscriptAPI (one retry
 * after 2 s on HTTP 408), cache it, render the Markdown and write the
 * scratch copy or the kept file. The transcript text never reaches stdout:
 * the outcome is one report object and an exit code (0 ok, 2 usage, 3 no
 * captions, 4 API or other error, 5 exists). Writes nothing without
 * `live`. Filesystem and network I/O (fetch injectable).
 */

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { retryAsync } from '@karmaniverous/jeeves';

import { cachePath, isKept, targetPath, type TranscriptDirs } from './paths.js';
import {
  renderTranscript,
  transcriptResponseSchema,
} from './render-markdown.js';
import { parseVideoId } from './youtube-id.js';

/** The TranscriptAPI endpoint. */
export const TRANSCRIPT_API =
  'https://transcriptapi.com/api/v2/youtube/transcript';

/** The usage line (exit 2). */
export const USAGE =
  'usage: run transcripts-fetch-video <video-url-or-id> [--keep] [--out FILE | --dir DIR] [--force] [--live]';

/** Exit codes. */
export const EXIT = {
  ok: 0,
  usage: 2,
  noCaptions: 3,
  error: 4,
  exists: 5,
} as const;

/** The exists message (exit 5). */
const EXISTS = 'file exists; pass --force to overwrite or choose --out';

/** What was asked for. */
export interface FileTranscriptRequest {
  /** The positional arguments: exactly one video URL or id. */
  positionals: readonly string[];
  /** File it in the library. */
  keep: boolean;
  /** Library directory override (implies `keep`). */
  dir?: string | undefined;
  /** Exact output path (implies `keep`). */
  out?: string | undefined;
  /** Overwrite a kept file, and refetch instead of using the cache. */
  force: boolean;
  /** Write (default: report only). */
  live: boolean;
}

/** What the run needs from outside. */
export interface FileTranscriptDeps {
  /** The resolved library and scratch directories. */
  dirs: TranscriptDirs;
  /** The User-Agent sent to the API. */
  userAgent: string;
  /** `TRANSCRIPT_API_KEY`, when set. */
  apiKey: string | undefined;
  /** The HTTP client. */
  fetch: typeof fetch;
  /** The current time (the `retrieved` date). */
  now: () => Date;
  /** The wait before the 408 retry (default a real timer). */
  sleep?: (ms: number) => Promise<void>;
}

/** The exit code and the one JSON line to print. */
export interface FileTranscriptOutcome {
  /** The process exit code. */
  code: number;
  /** The report (`ok: false` with `error` on failure). */
  report: Record<string, unknown>;
}

/** A failure outcome. */
const fail = (
  code: number,
  error: string,
  extra: Record<string, unknown> = {},
): FileTranscriptOutcome => ({ code, report: { ok: false, error, ...extra } });

const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false,
  );

/** A 408 response, thrown so the retry helper retries it. */
class RequestTimeout extends Error {
  constructor(readonly response: Response) {
    super('TranscriptAPI HTTP 408');
  }
}

/** GET the transcript, retrying a 408 once after 2 s; the last response either way. */
const getTranscript = async (
  videoId: string,
  deps: FileTranscriptDeps,
  apiKey: string,
): Promise<Response> => {
  const url = `${TRANSCRIPT_API}?${new URLSearchParams({
    video_url: videoId,
    format: 'json',
    include_timestamp: 'true',
    send_metadata: 'true',
  }).toString()}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'User-Agent': deps.userAgent,
  };
  try {
    return await retryAsync(
      async () => {
        const res = await deps.fetch(url, {
          headers,
          signal: AbortSignal.timeout(60_000),
        });
        if (res.status === 408) throw new RequestTimeout(res);
        return res;
      },
      {
        attempts: 2,
        delayMs: () => 2000,
        isRetryable: (err) => err instanceof RequestTimeout,
        ...(deps.sleep ? { sleep: deps.sleep } : {}),
      },
    );
  } catch (err) {
    if (err instanceof RequestTimeout) return err.response;
    throw err;
  }
};

/** The cached response, or `undefined` when there is none or it is not JSON. */
const readCache = async (file: string): Promise<unknown> => {
  if (!(await exists(file))) return undefined;
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
};

/** Fetch (or reuse), render and file one transcript. */
export const fileTranscript = async (
  req: FileTranscriptRequest,
  deps: FileTranscriptDeps,
): Promise<FileTranscriptOutcome> => {
  const [video, extra] = req.positionals;
  if (extra !== undefined)
    return fail(EXIT.usage, `unknown argument: ${extra}`);
  if (video === undefined) return fail(EXIT.usage, USAGE);
  if (req.out !== undefined && req.dir !== undefined)
    return fail(EXIT.usage, '--out and --dir are mutually exclusive');
  const videoId = parseVideoId(video);
  if (videoId === undefined)
    return fail(EXIT.usage, `cannot find a YouTube video id in: ${video}`);
  if (req.out !== undefined && !req.force && (await exists(resolve(req.out))))
    return fail(EXIT.exists, EXISTS, { path: resolve(req.out) });

  const cacheFile = cachePath(deps.dirs.scratchDir, videoId);
  let data = req.force ? undefined : await readCache(cacheFile);
  const cached = data !== undefined;
  if (!cached) {
    if (!deps.apiKey) return fail(EXIT.error, 'TRANSCRIPT_API_KEY is not set');
    let res: Response;
    try {
      res = await getTranscript(videoId, deps, deps.apiKey);
    } catch (err) {
      return fail(EXIT.error, `request failed: ${(err as Error).message}`);
    }
    if (res.status === 404)
      return fail(
        EXIT.noCaptions,
        'no transcript: video not found or has no captions',
        { status: 404 },
      );
    if (!res.ok)
      return fail(EXIT.error, `TranscriptAPI HTTP ${String(res.status)}`, {
        status: res.status,
        body: (await res.text()).slice(0, 200),
      });
    try {
      data = await res.json();
    } catch {
      return fail(EXIT.error, 'TranscriptAPI returned invalid JSON');
    }
    if (req.live) {
      await mkdir(deps.dirs.scratchDir, { recursive: true });
      await writeFile(cacheFile, JSON.stringify(data), 'utf8');
    }
  }

  const parsed = transcriptResponseSchema.safeParse(data);
  if (!parsed.success)
    return fail(EXIT.error, 'response missing transcript or metadata');
  const rendered = renderTranscript(
    parsed.data,
    videoId,
    deps.now().toISOString().slice(0, 10),
  );
  const kept = isKept(req);
  const path = targetPath(req, deps.dirs, rendered.videoId, rendered.keptName);
  const report = {
    ok: true,
    kept,
    cached,
    dryRun: !req.live,
    path,
    video_id: rendered.videoId,
    title: rendered.title,
    author: rendered.author,
    length: rendered.length,
    segments: rendered.segments,
    words: rendered.words,
  };
  // Scratch copies are always rewritten; kept files never without --force.
  if (kept && !req.force && (await exists(path)))
    return fail(EXIT.exists, EXISTS, { path });
  if (req.live) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, rendered.markdown, 'utf8');
  }
  return { code: EXIT.ok, report };
};
