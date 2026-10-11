/**
 * @module lib/runner-config
 *
 * The jeeves-runner's address, read from the runner's own config
 * (`{configRoot}/jeeves-runner/config.json`, validated with the runner's
 * `runnerConfigSchema`, which defaults `port` to 1937). Scripts that call
 * the runner's HTTP API use this instead of a hard-coded port. The runner
 * binds all interfaces by default, so it is reached on loopback.
 */

import { runnerConfigSchema } from '@karmaniverous/jeeves-runner';

import {
  componentConfigPath,
  readComponentConfig,
} from './component-config.js';

/** The runner's validated config (defaults applied; schema defaults when the file does not exist). */
export const runnerConfig = (file: string = componentConfigPath('runner')) =>
  readComponentConfig('runner', runnerConfigSchema, file) ??
  runnerConfigSchema.parse({});

/** Base URL of the runner's HTTP API, e.g. `http://127.0.0.1:1937`. */
export const runnerUrl = (file?: string): string =>
  `http://127.0.0.1:${String(runnerConfig(file).port)}`;

/** The runner's reply to a trigger request. */
export interface RunnerTriggerResult {
  /** HTTP status. */
  status: number;
  /** Response body text. */
  body: string;
}

/**
 * Ask the runner to run a job now (`POST /jobs/:id/run`).
 *
 * @param jobId - Runner job id.
 * @param file - Runner config file. Default: {@link componentConfigPath}`('runner')`.
 * @throws When the runner cannot be reached.
 */
export const triggerRunnerJob = async (
  jobId: string,
  file?: string,
): Promise<RunnerTriggerResult> => {
  const res = await fetch(
    `${runnerUrl(file)}/jobs/${encodeURIComponent(jobId)}/run`,
    { method: 'POST' },
  );
  return { status: res.status, body: await res.text() };
};
