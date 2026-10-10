/**
 * `@karmaniverous/jeeves-scripts-core`: shared Jeeves scripts domains, job
 * registry and CLI for `jeeves-scripts` instance repos.
 *
 * The root export is the API instance code builds on (Decision 7): the
 * config API, the task-file dispatcher, and the readers for other
 * components' own config (OpenClaw, the runner, any `jeeves-<name>`).
 * Every other built module is reachable as
 * `@karmaniverous/jeeves-scripts-core/<domain>/<module>` while the job
 * registry is pending (Decision 32). The CLI entry point is the separate
 * `@karmaniverous/jeeves-scripts-core/cli` export.
 *
 * @packageDocumentation
 */

export * from './config/index.js';
export * from './dispatchers/lib/task-file-dispatcher.js';
export * from './lib/component-config.js';
export * from './lib/openclaw-config.js';
export * from './lib/runner-config.js';
export * from './lib/worker-slack/worker-slack-config.js';
export type { WorkerSlackResult } from './lib/worker-slack/worker-slack-job.js';
