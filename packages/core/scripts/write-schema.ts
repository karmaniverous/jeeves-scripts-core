/**
 * Writes `packages/core/schema/jeeves-scripts.schema.json`, the JSON Schema
 * generated from core's Zod config schema (Decision 3). Instance configs
 * point their `$schema` at it through `node_modules`, so it is listed in
 * core's `files`.
 *
 * Run as part of `npm run build` in this package.
 *
 * @module scripts/write-schema
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { generateJsonSchema } from '../src/config/json-schema.js';

const schemaDir = fileURLToPath(new URL('../schema/', import.meta.url));
const schemaFile = `${schemaDir}jeeves-scripts.schema.json`;

fs.mkdirSync(schemaDir, { recursive: true });
fs.writeFileSync(
  schemaFile,
  `${JSON.stringify(generateJsonSchema(), null, 2)}\n`,
);

console.info(`[write-schema] wrote ${schemaFile}`);
