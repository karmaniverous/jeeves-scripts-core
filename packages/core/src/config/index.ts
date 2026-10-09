/**
 * @module config
 *
 * Public config API (Decision 3, Decision 19, Decision 28): schema,
 * loader, typed getters (`paths()`, `integrations()`, `pipeline()`),
 * pipeline accessors, the silo resolver and routing functions, JSON
 * Schema generation and `config check`.
 */

export { configCheck, type ConfigCheckResult } from './check.js';
export {
  isSafeSecretRef,
  resolveImapPassword,
  UNSAFE_SECRET_REF_MESSAGE,
} from './imap-secrets.js';
export {
  deriveIntegrations,
  integrations,
  type ResolvedIntegrations,
} from './integrations.js';
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
export {
  type AccountConfig,
  type BucketsConfig,
  type Config,
  configSchema,
  type EmailConfig,
  type ExtensionsConfig,
  type GitHubOrgEntry,
  type GitHubOrgSpec,
  type ImapConnection,
  type InstanceConfig,
  type IntegrationsConfig,
  type JobDelta,
  type JobsConfig,
  type PathsConfigInput,
  type PipelineConfig,
  type SiloConfig,
  type SiloRoutingConfig,
  type XAccountConfig,
} from './schema.js';
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
  siloPath,
  siloRouting,
  UnknownSiloError,
} from './silo-router.js';
