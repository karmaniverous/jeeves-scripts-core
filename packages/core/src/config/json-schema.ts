/**
 * @module config/json-schema
 *
 * Generates a JSON Schema from the Zod config schema (Decision 3: "A
 * generated JSON Schema gives editor completion"). Uses Zod 4's native
 * `z.toJSONSchema`.
 */

import { z } from 'zod';

import { configSchema } from './schema.js';

/** The generated JSON Schema for `jeeves-scripts.json`. */
export const generateJsonSchema = (): Record<string, unknown> =>
  z.toJSONSchema(configSchema, { target: 'draft-7' });
