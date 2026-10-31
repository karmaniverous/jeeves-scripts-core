/**
 * @module transcripts/lib/youtube-id
 *
 * A YouTube URL or bare id → the 11-character video id: a bare id, or a
 * `watch?v=`, `youtu.be/`, `/shorts/`, `/embed/` or `/live/` URL. Pure.
 */

/** A bare 11-character id. */
const BARE_ID = /^[\w-]{11}$/;
/** The id in a watch, short-link, shorts, embed or live URL. */
const URL_ID =
  /(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/;

/** The video id in `input`, or `undefined` when there is none. */
export const parseVideoId = (input: string): string | undefined =>
  BARE_ID.test(input) ? input : URL_ID.exec(input)?.[1];
