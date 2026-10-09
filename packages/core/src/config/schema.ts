/**
 * @module config/schema
 *
 * The single `jeeves-scripts.json` schema (Decision 3, Decision 19):
 * instance settings (today's constants), `paths` overrides,
 * `integrations`, `pipeline` (today's `pipeline-config.json`, same keys),
 * `siloRouting` (today's `silo-routing.json`), `jobs` deltas and
 * `extensions`. Rejects any literal secret value anywhere in the tree
 * (Decision 19; see `config/secret-guard.ts`).
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

const instanceSchema = z.object({
  name: z.string().min(1),
  baseDir: z.string().min(1),
});

export const configSchema = z
  .object({
    $schema: z.string().optional(),
    instance: instanceSchema,
    paths: pathsSchema.default({}),
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
    pipeline: pipelineSchema.optional(),
    siloRouting: siloRoutingSchema.default({ silos: {} }),
    jobs: jobsSchema,
    extensions: extensionsSchema,
  })
  .superRefine((data, ctx) => {
    for (const finding of findSecretLiterals(data)) {
      ctx.addIssue({
        code: 'custom',
        message: `"${finding.key}" must not hold a literal secret value; use { "secretRef": "<name>" } or a credential file path instead.`,
        path: finding.path,
      });
    }
  });

export type Config = z.infer<typeof configSchema>;
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
