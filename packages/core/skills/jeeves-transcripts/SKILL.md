---
name: jeeves-transcripts
description: 'YouTube link or video mentioned in chat: script-fetch its transcript via TranscriptAPI to a file, answer from the file with minimal context, and file it in the library only when filing is intended.'
metadata:
  {
    'openclaw':
      {
        'requires': { 'env': ['JEEVES_SCRIPTS_DIR', 'TRANSCRIPT_API_KEY'] },
        'primaryEnv': 'TRANSCRIPT_API_KEY',
      },
  }
---

# Transcripts

`transcripts-fetch-video` fetches a transcript and writes it to disk; you never retype it and never hold all of it. Read [transcripts.md]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/transcripts.md) for flags, exit codes and config.

## Steps

1. **Judge filing intent.** "File/save/archive this" or a video worth keeping: `--keep`. Questions about a video ("what does she say about X?"): a scratch copy. Unclear: ask once.
2. **Run it**: `node "$JEEVES_SCRIPTS_DIR/bin/jeeves-scripts.js" run transcripts-fetch-video <url-or-id> --live [--keep] [--dir DIR | --out FILE]`. It prints one JSON line: `path`, `title`, `author`, `length`, `words`, `cached`.
3. **Answer from the file, reading little.** Grep it, or read ranges around the hits; never read a whole long transcript into context. Above about 5,000 words, hand the question and the path to a sub-agent.
4. **If kept, check it is indexed:** `watcher_scan` with a `file_path` filter on `path` and `countOnly: true`; a count of 0 shortly after is normal, so check again before reporting it missing.
5. **Report** the answer, and for a kept file its jeeves-server link.

## Exit codes

`3`: no captions, so say so. `5`: already filed, so use the existing file (or `--force` only if asked to refresh). `4` with `TRANSCRIPT_API_KEY is not set`: the operator sets this skill's API key. Never edit transcript files by hand.

## Notes

- TranscriptAPI is billed per credit; a cached response is reused for free, so keeping a video already fetched with `--live` costs nothing. A run without `--live` still spends a credit and caches nothing.
- An instance's routing (a channel whose videos are always filed, people whose links are always kept) belongs in an instance skill that layers on this one.
- Searching YouTube, channels or playlists is the optional `transcriptapi` skill's job, not this one.
