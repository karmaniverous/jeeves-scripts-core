/**
 * @module lib/json-file
 *
 * Validated JSON file I/O for instance code: read, parse and Zod-validate
 * (throwing, unlike `@karmaniverous/jeeves`'s fallback `readJson`), and an
 * atomic write with a chosen indent (`writeJsonAtomic` fixes it at 2). On
 * the root export.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { z } from 'zod';

/**
 * Read and validate a JSON file.
 *
 * @throws On a missing file, bad JSON or a schema mismatch.
 */
export function readJsonFile<S extends z.ZodType>(
  file: string,
  schema: S,
): z.infer<S> {
  return schema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
}

/** Read and validate a JSON file, or return `fallback` when it doesn't exist. */
export function readJsonFileIfExists<S extends z.ZodType>(
  file: string,
  schema: S,
  fallback: z.infer<S>,
): z.infer<S> {
  return fs.existsSync(file) ? readJsonFile(file, schema) : fallback;
}

/**
 * Write JSON (UTF-8) atomically: a temp file in the same directory, then a
 * rename. `indent` 0 writes compact JSON; parent directories are created.
 */
export function writeJsonFile(file: string, data: unknown, indent = 2): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${String(process.pid)}.tmp`;
  fs.writeFileSync(
    tmp,
    indent ? JSON.stringify(data, null, indent) : JSON.stringify(data),
    'utf8',
  );
  fs.renameSync(tmp, file);
}
