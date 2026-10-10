/**
 * @module slack/lib/message-writer
 *
 * Write one polled Slack message as `{channelDir}/{ts}.json`: author name
 * from the users map, thread and reaction fields, file metadata with
 * native audio transcripts and inlined text. Never overwrites an existing
 * message file.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { ChannelInfo } from './channel-info.js';
import { type SlackFileMetadata, type SlackMessage } from './slack-api.js';

function tsToDate(ts: string): string {
  return new Date(parseFloat(ts) * 1000).toISOString();
}

/**
 * Write `msg` to `{channelDir}/{ts}.json`, creating the directory.
 *
 * @returns `false` when the file already exists (nothing written).
 */
export function writeMessage(
  channelDir: string,
  channelId: string,
  channelInfo: ChannelInfo,
  msg: SlackMessage,
  userMap: Record<string, string>,
): boolean {
  fs.mkdirSync(channelDir, { recursive: true });

  const filePath = path.join(channelDir, `${msg.ts}.json`);
  if (fs.existsSync(filePath)) return false;

  const doc: Record<string, unknown> = {
    ts: msg.ts,
    channelId,
    channelName: channelInfo.name,
    channelType: channelInfo.type,
    user: msg.user ?? msg.bot_id ?? 'unknown',
    userName:
      (msg.user ? userMap[msg.user] : undefined) ??
      msg.username ??
      msg.bot_id ??
      'unknown',
    text: msg.text ?? '',
    date: tsToDate(msg.ts),
    participants: channelInfo.participants,
  };

  if (msg.thread_ts && msg.thread_ts !== msg.ts) doc.threadTs = msg.thread_ts;
  if (msg.reply_count) doc.replyCount = msg.reply_count;
  if (msg.subtype) doc.subtype = msg.subtype;
  if (msg.bot_id) doc.botId = msg.bot_id;
  if (msg.files && msg.files.length > 0) {
    doc.hasFiles = true;
    doc.files = msg.files.map((f: SlackFileMetadata) => {
      const entry: SlackFileMetadata = {
        id: f.id,
        name: f.name,
        filetype: f.filetype,
        mimetype: f.mimetype,
        ...(f.size != null ? { size: f.size } : {}),
      };

      // Persist voice memo / audio transcripts from Slack's native transcription
      const raw = f as unknown as Record<string, unknown>;
      const transcription = raw.transcription as
        { status?: string; preview?: { content?: string } } | undefined;
      if (
        transcription?.status === 'complete' &&
        transcription.preview?.content
      ) {
        entry.transcript = transcription.preview.content;
      }

      // Inline text content fetched during enrichment
      if (f.markdown) {
        entry.markdown = f.markdown;
      }

      return entry;
    });
  }
  if (msg.reactions)
    doc.reactions = msg.reactions.map((r) => ({
      name: r.name,
      count: r.count,
    }));

  fs.writeFileSync(filePath, JSON.stringify(doc, null, 2), 'utf8');
  return true;
}
