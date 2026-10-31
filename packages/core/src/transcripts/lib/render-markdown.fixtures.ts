/**
 * @module transcripts/lib/render-markdown.fixtures
 *
 * The parity fixture: an API response, and the Markdown the prototype
 * script wrote for it (`--out`, retrieved 2026-10-31), byte for byte.
 * The response mixes accents, a curly apostrophe, quotes, collapsed
 * whitespace, an empty segment and an hour-plus length.
 */

/** The API response (`format=json`, timestamps and metadata included). */
export const PROTOTYPE_RESPONSE = {
  video_id: 'dQw4w9WgXcQ',
  language: 'en',
  transcript: [
    {
      text: 'Welcome  to the   talk.',
      start: 0,
      duration: 4.2,
    },
    {
      text: 'Today we cover\nthree ideas.',
      start: 4.2,
      duration: 5.5,
    },
    {
      text: 'It’s about café design — really.',
      start: 61.9,
      duration: 3,
    },
    {
      text: '',
      start: 125,
      duration: 1,
    },
    {
      text: 'Final words at the hour mark.',
      start: 3599.5,
      duration: 12.75,
    },
  ],
  metadata: {
    title: 'Café Design: It’s "Simple" (Part 1)',
    author_name: "Ana Example's Channel",
    author_url: 'https://www.youtube.com/@example',
    thumbnail_url: 'https://i.ytimg.com/x.jpg',
  },
};

/** The date the prototype stamped as `retrieved`. */
export const PROTOTYPE_RETRIEVED = '2026-10-31';

/** The prototype's report for a kept run under directory `lib`. */
export const PROTOTYPE_KEPT_NAME =
  'cafe-design-its-simple-part-1-ana-examples-channel.md';

/** The prototype's Markdown for {@link PROTOTYPE_RESPONSE}. */
export const PROTOTYPE_MARKDOWN =
  '---\ntitle: "Café Design: It’s \\"Simple\\" (Part 1)"\nauthor: "Ana Example\'s Channel"\nauthor_url: https://www.youtube.com/@example\nsource: https://www.youtube.com/watch?v=dQw4w9WgXcQ\nvideo_id: dQw4w9WgXcQ\nlength: "1:00:12"\nlanguage: en\ntype: video-transcript\nretrieved: 2026-10-31\nretrieved_via: TranscriptAPI (auto-generated captions)\n---\n\n# Café Design: It’s "Simple" (Part 1)\n\n**Source:** [https://www.youtube.com/watch?v=dQw4w9WgXcQ](https://www.youtube.com/watch?v=dQw4w9WgXcQ)  \n**Author:** [Ana Example\'s Channel](https://www.youtube.com/@example) · 1:00:12\n\n> Auto-generated YouTube captions; expect transcription errors.\n\n## Transcript\n\n[0:00] Welcome to the talk.  \n[0:04] Today we cover three ideas.  \n[1:01] It’s about café design — really.  \n[2:05]   \n[59:59] Final words at the hour mark.\n';
