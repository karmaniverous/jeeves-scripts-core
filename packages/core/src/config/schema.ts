/**
 * @module config/schema
 *
 * The single `jeeves-scripts.json` schema (Decision 3, Decision 19):
 * instance settings (today's constants), `paths` overrides,
 * `integrations`, `pipeline` (today's `pipeline-config.json`, same keys),
 * `siloRouting` (today's `silo-routing.json`), `jobs` deltas and
 * `extensions`.
 *
 * Rejects any literal secret value anywhere in the raw tree (Decision
 * 19; see `config/secret-guard.ts`), checked against the *raw* parsed
 * JSON before `z.object()` strips unrecognized keys — otherwise an
 * unknown key holding a secret would be silently dropped instead of
 * rejected.
 */

import { z } from 'zod';

import {
  defaultXIntegration,
  integrationsSchema,
} from './integrations-schema.js';
import { extensionsSchema, jobsSchema } from './jobs-schema.js';
import { pathsSchema } from './paths-schema.js';
import { pipelineSchema } from './pipeline-schema.js';
import { findSecretLiterals } from './secret-guard.js';
import { siloRoutingSchema } from './silo-schema.js';

/** The `instance` block: who this instance is and where it lives. */
export const instanceSchema = z.object({
  /** Instance name (e.g. `jgs`). */
  name: z.string().min(1),
  /** Base directory every default path derives from. */
  baseDir: z.string().min(1),
});

/**
 * The plain config shape, with no secret-literal scan. Exported
 * separately so JSON Schema generation (`config/json-schema.ts`) has a
 * concrete object schema to introspect; use {@link configSchema} to
 * validate.
 */
export const configObjectSchema = z.object({
  /** JSON Schema reference for editor completion. */
  $schema: z.string().optional(),
  /** Instance identity and base directory. */
  instance: instanceSchema,
  /** Path overrides. */
  paths: pathsSchema.default({}),
  /** External tools and services. */
  integrations: integrationsSchema.default({
    gh: {},
    qdrant: {},
    gateway: {},
    gog: {},
    slack: {},
    notion: {},
    jira: {},
    linear: {},
    x: defaultXIntegration,
  }),
  /** Mail, calendar and refs (today's `pipeline-config.json`). */
  pipeline: pipelineSchema.optional(),
  /** Data silos (Decision 28). */
  siloRouting: siloRoutingSchema.default({ silos: {} }),
  /** Per-job deltas. */
  jobs: jobsSchema,
  /** Seam implementations. */
  extensions: extensionsSchema,
});

/**
 * Scans the raw input for literal secret values, then validates it
 * against {@link configObjectSchema}. Scanning first (rather than via
 * `superRefine` on the object schema) means a secret under a key the
 * schema doesn't recognize is rejected instead of silently stripped.
 */
export const configSchema = z
  .unknown()
  .superRefine((data, ctx) => {
    for (const finding of findSecretLiterals(data)) {
      ctx.addIssue({
        code: 'custom',
        message: `"${finding.key}" must not hold a literal secret value; use { "secretRef": "<name>" } or a credential file path instead.`,
        path: finding.path,
      });
    }
  })
  .pipe(configObjectSchema);

/** A validated `jeeves-scripts.json`. */
export type Config = z.infer<typeof configSchema>;
/** Parsed `instance` block. */
export type InstanceConfig = z.infer<typeof instanceSchema>;

export {
  type IntegrationsConfig,
  type XAccountConfig,
} from './integrations-schema.js';
export {
  type ExtensionsConfig,
  type JobDelta,
  type JobsConfig,
} from './jobs-schema.js';
export { type PathsConfigInput } from './paths-schema.js';
export {
  type AccountConfig,
  type BucketsConfig,
  type EmailConfig,
  type ImapConnection,
  type PipelineConfig,
} from './pipeline-schema.js';
export {
  type GitHubOrgEntry,
  type GitHubOrgSpec,
  type SiloConfig,
  type SiloRoutingConfig,
} from './silo-schema.js';
