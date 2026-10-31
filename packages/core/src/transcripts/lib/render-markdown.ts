/**
 * @module transcripts/lib/render-markdown
 *
 * A TranscriptAPI response → the filed Markdown: YAML frontmatter
 * (`title`, `author`, `author_url`, `source`, `video_id`, `length`,
 * `language`, `type`, `retrieved`, `retrieved_via`), a header, and one
 * `[m:ss]`-stamped line per caption segment, byte-identical to the
 * prototype's output for the same response. Also the file-name slug and
 * the report's counts. Pure.
 */

import { z } from 'zod';

/** One caption segment, as the API returns it. */
const segmentSchema = z.looseObject({
  text: z.unknown().optional(),
  start: z.unknown().optional(),
  duration: z.unknown().optional(),
});

/** The parts of a response the renderer reads; checked before rendering. */
export const transcriptResponseSchema = z.looseObject({
  video_id: z.string().optional(),
  language: z.string().optional(),
  transcript: z.array(segmentSchema).min(1),
  metadata: z.looseObject({
    title: z.string().optional(),
    author_name: z.string().optional(),
    author_url: z.string().optional(),
  }),
});

/** A response that can be rendered. */
export type TranscriptResponse = z.infer<typeof transcriptResponseSchema>;

/** `String(value ?? '')`, without stringifying objects as `[object Object]` silently. */
const str = (value: unknown): string =>
  value === undefined || value === null
    ? ''
    : typeof value === 'string'
      ? value
      : JSON.stringify(value);

/** A file-name slug: ASCII, lower case, hyphenated, at most 60 characters; `untitled` when empty. */
export const slug = (value: unknown): string =>
  str(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '') || 'untitled';

/** Seconds → `m:ss`, or `h:mm:ss` from an hour. */
export const clock = (seconds: number): string => {
  const t = Math.floor(seconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, '0');
  return h
    ? `${String(h)}:${String(m).padStart(2, '0')}:${ss}`
    : `${String(m)}:${ss}`;
};

/** What a rendered transcript reports. */
export interface RenderedTranscript {
  /** The Markdown file content. */
  markdown: string;
  /** The video id (the response's, else the requested one). */
  videoId: string;
  /** The video title, when the response has one. */
  title: string | undefined;
  /** The channel name, when the response has one. */
  author: string | undefined;
  /** The video length, `m:ss` or `h:mm:ss`. */
  length: string;
  /** Caption segments. */
  segments: number;
  /** Words across every segment. */
  words: number;
  /** The kept file's name: `<title-slug>-<author-slug>.md`. */
  keptName: string;
}

/**
 * Render a response.
 *
 * @param data - A response that passed {@link transcriptResponseSchema}.
 * @param videoId - The id that was requested (used when the response has none).
 * @param retrieved - The `YYYY-MM-DD` stamped as `retrieved`.
 */
export const renderTranscript = (
  data: TranscriptResponse,
  videoId: string,
  retrieved: string,
): RenderedTranscript => {
  const segs = data.transcript;
  const md = data.metadata;
  const id = data.video_id ?? videoId;
  const last = segs[segs.length - 1] ?? {};
  const length = clock(Number(last.start ?? 0) + Number(last.duration ?? 0));
  const source = `https://www.youtube.com/watch?v=${id}`;
  const lines = segs.map(
    (s) =>
      `[${clock(Number(s.start ?? 0))}] ${str(s.text).replace(/\s+/g, ' ').trim()}`,
  );
  const yaml = (value: unknown): string => JSON.stringify(str(value));
  const markdown = [
    '---',
    `title: ${yaml(md.title)}`,
    `author: ${yaml(md.author_name)}`,
    `author_url: ${md.author_url ?? ''}`,
    `source: ${source}`,
    `video_id: ${id}`,
    `length: "${length}"`,
    `language: ${data.language ?? ''}`,
    'type: video-transcript',
    `retrieved: ${retrieved}`,
    'retrieved_via: TranscriptAPI (auto-generated captions)',
    '---',
    '',
    `# ${md.title ?? id}`,
    '',
    `**Source:** [${source}](${source})  `,
    `**Author:** [${md.author_name ?? ''}](${md.author_url ?? ''}) · ${length}`,
    '',
    '> Auto-generated YouTube captions; expect transcription errors.',
    '',
    '## Transcript',
    '',
    lines.join('  \n'),
    '',
  ].join('\n');
  const words = segs.reduce(
    (n, s) => n + str(s.text).split(/\s+/).filter(Boolean).length,
    0,
  );
  return {
    markdown,
    videoId: id,
    title: md.title,
    author: md.author_name,
    length,
    segments: segs.length,
    words,
    keptName: `${slug(md.title)}-${slug(md.author_name)}.md`,
  };
};
