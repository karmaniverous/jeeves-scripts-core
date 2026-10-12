/**
 * `@karmaniverous/jeeves-scripts-core`: shared Jeeves scripts domains,
 * runnable registry and CLI for `jeeves-scripts` instance repos.
 *
 * The root export is the only API instance code builds on (Decision 7,
 * design §3): the config API, `constants()`, `defineJob` (Decisions 4, 40,
 * 49), the plugin API (`definePlugin`, `override`, `localConfig`) and the
 * utilities (the task-file dispatcher and its date helpers,
 * worker dispatch with job-side Slack I/O, the readers for other
 * components' own config, the `gh` helpers, token-metrics queries, the
 * document converters, the runnable argument parser, the Slack Web API
 * client, retry and JSON file helpers). No other built module is exported; the CLI entry
 * point is the separate `@karmaniverous/jeeves-scripts-core/cli` export.
 *
 * @packageDocumentation
 */

export {
  getTokenMetrics,
  type TokenMetricsBound,
  type TokenMetricsOptions,
} from './admin/token-metrics.js';
export type {
  ChannelBucket,
  Channels,
  Costs,
  ModelBucket,
  Models,
  Ref,
  TokenBucket,
  TokenCategory,
  Tokens,
} from './admin/types/token-metrics.js';
export * from './config/index.js';
export { convertDocxToMd } from './convert/docx-to-md.js';
export type { ConvertResult } from './convert/lib/convert-files.js';
export { convertPdfToMd } from './convert/pdf-to-md.js';
export {
  DIGEST_TIMEZONE_REF,
  digestTimeZone,
} from './dispatchers/lib/digest-timezone.js';
export * from './dispatchers/lib/task-file-dispatcher.js';
export {
  defineJob,
  isJobModule,
  type JobContext,
  jobContextSchema,
  type JobDeclaration,
  jobDeclarationSchema,
  type JobModule,
  type JobPrerequisite,
  type JobRun,
} from './jobs/define-job.js';
export {
  definePlugin,
  isJobOverride,
  isPlugin,
  type JobOverride,
  type JobOverrideDeclaration,
  jobOverrideDeclarationSchema,
  localConfig,
  type LocalConfigSchema,
  override,
  type Plugin,
  type PluginDeclaration,
  pluginDeclarationSchema,
} from './jobs/plugin.js';
export {
  argFlag,
  argOptional,
  type ArgSpec,
  argValue,
  type ArgValueOptions,
  type FlagSpec,
  type OptionalSpec,
  type ParsedArgs,
  parseRunnableArgs,
  positionalArgs,
  type ValueSpec,
} from './lib/args.js';
export * from './lib/component-config.js';
export { type Constants, constants } from './lib/constants.js';
export {
  dayOfWeek,
  formatDate,
  relativeDays,
  requireTimeZone,
  withDateContext,
} from './lib/dates.js';
export { gh, ghApi, ghJson, type GhResult, setupGhConfig } from './lib/gh.js';
export {
  readJsonFile,
  readJsonFileIfExists,
  writeJsonFile,
} from './lib/json-file.js';
export * from './lib/meta-config.js';
export * from './lib/openclaw-config.js';
export {
  exponentialBackoff,
  retryAsync,
  type RetryPolicy,
  retrySync,
} from './lib/retry.js';
export * from './lib/runner-config.js';
export {
  createSlackClient,
  SlackApiError,
  type SlackClient,
  type SlackClientOptions,
  type SlackFileUpload,
  type SlackPostedMessage,
  type SlackPostMessageOptions,
  type SlackResponse,
} from './lib/slack-client.js';
export { dispatchWithSlack } from './lib/worker-slack/run.js';
export * from './lib/worker-slack/worker-slack-config.js';
export type { WorkerSlackResult } from './lib/worker-slack/worker-slack-job.js';
