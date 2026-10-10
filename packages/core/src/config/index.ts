/**
 * @module config
 *
 * Public config API (Decision 3, Decision 19, Decision 28): schema,
 * loader, typed getters (`paths()`, `integrations()`, `pipeline()`),
 * pipeline accessors, the silo resolver and routing functions, JSON
 * Schema generation and `config check`.
 */

export { configCheck, type ConfigCheckResult } from './check.js';
// Every Zod schema is public (Decision 31), so plugins can compose and
// extend them and the docs can describe each type.
export {
  type ImapPassword,
  imapSecretPath,
  isSafeSecretRef,
  resolveImapPassword,
  UNSAFE_SECRET_REF_MESSAGE,
} from './imap-secrets.js';
export {
  deriveIntegrations,
  integrations,
  type Resolved,
  type ResolvedIntegrations,
} from './integrations.js';
export * from './integrations-schema.js';
export * from './jobs-schema.js';
export { generateJsonSchema } from './json-schema.js';
export {
  CONFIG_PATH_ENV,
  getLoadedConfigPath,
  loadConfig,
  type LoadConfigOptions,
  resetConfig,
  resolveConfigPath,
} from './loader.js';
export { derivePaths, paths, type ResolvedPaths } from './paths.js';
export * from './paths-schema.js';
export * from './people-schema.js';
export {
  getBucketForDomain,
  getBucketNames,
  getBucketPriority,
  getCalendarAccounts,
  getEmailAccounts,
  getGmailAccounts,
  getRef,
  pipeline,
  tryGetRef,
} from './pipeline-accessors.js';
export * from './pipeline-email-schema.js';
export * from './pipeline-schema.js';
export * from './schema.js';
export {
  getBasePathForEmailDomain,
  getBasePathForGitHubOrg,
  getBasePathForJira,
  getBasePathForLinear,
  getBasePathForMeeting,
  getBasePathForSlackWorkspace,
  getCalendarBaseForAccount,
  getEmailBaseForAccount,
  getEntityDirs,
  isKnownSilo,
  type ResolvedSiloRouting,
  siloPath,
  siloRouting,
  UnknownSiloError,
} from './silo-router.js';
export * from './silo-schema.js';
export * from './slack-schema.js';
