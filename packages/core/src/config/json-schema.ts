/**
 * @module config/json-schema
 *
 * Generates a JSON Schema from the Zod config schema (Decision 3: "A
 * generated JSON Schema gives editor completion"). Uses Zod 4's native
 * `z.toJSONSchema`.
 */

import { z } from 'zod';

import { pointerSchema } from './pointer.js';
import { configObjectSchema } from './schema.js';

/** The generated JSON Schema for `jeeves-scripts.json`. */
export const generateJsonSchema = (): Record<string, unknown> =>
  z.toJSONSchema(configObjectSchema, { target: 'draft-7' });

/** The generated JSON Schema for a `jeeves-scripts.json` pointer (#57). */
export const generatePointerJsonSchema = (): Record<string, unknown> =>
  z.toJSONSchema(pointerSchema, { target: 'draft-7', io: 'input' });
