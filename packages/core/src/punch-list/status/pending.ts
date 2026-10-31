/**
 * @module punch-list/status/pending
 *
 * Status-checker notifications not yet posted. A transition is written to the punch list before it is
 * posted; if posting fails, the next run would see no transition and never
 * retry. So every message is saved here before it is posted and removed
 * once posted; each run posts what is left first.
 */

import { rmSync } from 'node:fs';

import { z } from 'zod';

import { readJsonFileIfExists, writeJsonFile } from '../../lib/json-file.js';

const pendingSchema = z.object({ messages: z.array(z.string()) });

/** Messages still to post. */
export const readPending = (file: string): string[] =>
  readJsonFileIfExists(file, pendingSchema, { messages: [] }).messages;

/** Save the messages still to post; none removes the file. */
export const writePending = (file: string, messages: string[]): void => {
  if (!messages.length) {
    rmSync(file, { force: true });
    return;
  }
  writeJsonFile(file, { messages });
};

/**
 * Post `fresh` after anything left over, saving the queue first and after
 * every successful post. A failed post leaves it and the rest queued.
 */
export const postQueued = async (
  file: string,
  fresh: string[],
  post: (message: string) => Promise<void>,
): Promise<void> => {
  const queue = [...readPending(file), ...fresh];
  writePending(file, queue);
  while (queue.length) {
    await post(queue[0] ?? '');
    queue.shift();
    writePending(file, queue);
  }
};
