/**
 * @module openclaw-db/schema-v24
 *
 * OpenClaw agent-DB schema 24 (OpenClaw 2026.9.33). Schema 24 adds
 * `session_nodes.snapshot_revision` and a `session_entry_snapshots` table,
 * and moves three `entry_json` fields into it (`sessionDiffBaseline`,
 * `skillsSnapshot`, `systemPromptReport`). Token metrics reads none of
 * those, and the transcript, conversation and window tables are unchanged,
 * so schema 24 reuses the schema-23 reader (#38).
 */

import { schemaV23 } from './schema-v23.js';
import type { OpenClawDbSchema } from './types.js';

/** The schema-24 reader: schema 23's, under version 24. */
export const schemaV24: OpenClawDbSchema = { ...schemaV23, version: 24 };
