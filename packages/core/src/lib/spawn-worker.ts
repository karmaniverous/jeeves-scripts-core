#!/usr/bin/env node
/**
 * @module spawn-worker
 *
 * Spawn Worker — invoke sessions_spawn via Gateway HTTP API.
 *
 * Usage: echo "task" | node <core>/dist/lib/spawn-worker.js --job-id=<id> [--label=<label>] [--thinking=<level>]
 * (run by jeeves-runner's `runDispatcher` / `dispatchSession` as
 * `constants().SPAWN_WORKER_PATH`).
 *
 * Spawns a worker session (retrying gateway timeouts with backoff) and
 * waits until the gateway reports its run ended (`lib/worker-session`);
 * the runner job timeout is the upper bound. On success, outputs a JSON
 * summary line (token usage from the session row) for async-wrapper to
 * parse; a failed/killed/timed-out run exits 1.
 *
 * Output format (last line of stdout):
 *   WORKER_RESULT:\{"sessionKey":"...","tokens":12345,"durationMs":123000\}
 */

import { sleepAsync } from '@karmaniverous/jeeves';
import { exponentialBackoff, retryAsync } from '@karmaniverous/jeeves';

import {
  type GatewayDetails,
  type GatewayResponse,
  invokeGateway,
  waitForWorkerCompletion,
} from './worker-session.js';

/** Maximum number of spawn retry attempts before giving up. */
export const SPAWN_MAX_RETRIES = 3;
/** Base backoff delay in ms between spawn retries (doubles each attempt). */
export const SPAWN_BACKOFF_BASE_MS = 30_000;

// ── Args ───────────────────────────────────────────────────────────────

/** Parsed `--key=value` arguments. */
export type ParsedArgs = Record<string, string>;

/** Arguments for `sessions_spawn`. */
export interface SpawnArgs {
  task: string;
  label: string;
  thread: boolean;
  thinking?: string;
}

/** Parse `--key=value` arguments; anything else is ignored. */
export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    const [, key, value] = match ?? [];
    if (key !== undefined && value !== undefined) args[key] = value;
  }
  return args;
}

// ── Spawn with retry ──────────────────────────────────────────────────

/** Collaborators of {@link spawnWithRetry}, injectable for tests. */
export interface SpawnDeps {
  invoke: typeof invokeGateway;
  sleep: (ms: number) => Promise<void>;
}

const defaultSpawnDeps: SpawnDeps = {
  invoke: invokeGateway,
  sleep: sleepAsync,
};

/**
 * Call `sessions_spawn`, retrying a gateway timeout (in the response body
 * or the error) up to {@link SPAWN_MAX_RETRIES} times with doubling backoff.
 *
 * @throws The last error, or when the result has no session key.
 */
export async function spawnWithRetry(
  spawnArgs: SpawnArgs,
  deps: SpawnDeps = defaultSpawnDeps,
): Promise<{ result: GatewayResponse; sessionKey: string }> {
  const BODY_TIMEOUT = 'gateway timeout in response body';
  return retryAsync(
    async () => {
      const result = await deps.invoke(
        'sessions_spawn',
        spawnArgs as unknown as Record<string, unknown>,
      );
      // A gateway timeout can arrive in the response body text.
      if (/gateway timeout/i.test(JSON.stringify(result)))
        throw new Error(BODY_TIMEOUT);

      const spawnResult = result.result?.details ?? result.details ?? result;
      const sessionKey =
        (spawnResult as GatewayDetails).childSessionKey ??
        (spawnResult as GatewayDetails).sessionKey;
      if (!sessionKey) {
        throw new Error(
          `No sessionKey in spawn result: ${JSON.stringify(result).slice(0, 500)}`,
        );
      }
      return { result, sessionKey };
    },
    {
      attempts: SPAWN_MAX_RETRIES,
      delayMs: exponentialBackoff(SPAWN_BACKOFF_BASE_MS),
      isRetryable: (err) =>
        /timeout/i.test(err instanceof Error ? err.message : String(err)),
      onRetry: (err, attempt, waitMs) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(
          `[${new Date().toISOString()}] Spawn attempt ${String(attempt)}/${String(SPAWN_MAX_RETRIES)} failed: ${msg === BODY_TIMEOUT ? 'gateway timeout in response' : msg}. Retrying in ${String(waitMs / 1000)}s...`,
        );
      },
      sleep: deps.sleep,
    },
  );
}

// CLI entry point

/** Read all of stdin (empty when it is a terminal). */
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => (data += chunk));
    process.stdin.on('end', () => {
      resolve(data.trim());
    });
    if (process.stdin.isTTY) {
      resolve('');
    }
  });
}

/** Collaborators of {@link workerMain}, injectable for tests. */
export interface WorkerMainDeps {
  /** The task text (default: stdin). */
  readTask: () => Promise<string>;
  /** Spawn the session (default: {@link spawnWithRetry}). */
  spawn: (
    args: SpawnArgs,
  ) => Promise<{ result: GatewayResponse; sessionKey: string }>;
  /** Wait for the run to end (default: `waitForWorkerCompletion`). */
  wait: typeof waitForWorkerCompletion;
  /** Clock (ms). */
  now: () => number;
}

const defaultWorkerMainDeps: WorkerMainDeps = {
  readTask: readStdin,
  spawn: (args) => spawnWithRetry(args),
  wait: waitForWorkerCompletion,
  now: Date.now,
};

const stamp = (deps: WorkerMainDeps): string =>
  new Date(deps.now()).toISOString();

/**
 * Spawn a worker for `argv` and wait for it.
 *
 * @returns The process exit code: 0 on success, 1 on a usage error, no
 * task, or a failed spawn or run.
 */
export async function workerMain(
  argv: string[],
  deps: WorkerMainDeps = defaultWorkerMainDeps,
): Promise<number> {
  const args = parseArgs(argv);
  const jobId = args['job-id'];
  if (!jobId) {
    console.error(
      'Usage: echo "task" | node spawn-worker.js --job-id=<id> [--label=<label>] [--thinking=<level>]',
    );
    return 1;
  }

  const taskInput = await deps.readTask();
  if (!taskInput) {
    console.error('Error: No task provided on stdin');
    return 1;
  }

  const startTime = deps.now();
  const spawnArgs: SpawnArgs = {
    task: taskInput,
    label: args.label ?? `worker-${jobId.slice(0, 8)}`,
    thread: false,
  };
  if (args.thinking) spawnArgs.thinking = args.thinking;

  console.log(`[${stamp(deps)}] Spawning worker for job ${jobId.slice(0, 8)}`);
  console.log(`  Label: ${spawnArgs.label}`);

  try {
    const { result, sessionKey } = await deps.spawn(spawnArgs);
    console.log(`[${stamp(deps)}] Worker spawned successfully`);
    console.log(
      `[${stamp(deps)}] Raw spawn result: ${JSON.stringify(result).slice(0, 500)}`,
    );
    console.log(
      `[${stamp(deps)}] Waiting for worker to complete (session: ${sessionKey})...`,
    );

    const completion = await deps.wait(sessionKey, startTime);
    if (!completion.success) {
      console.error(`[${stamp(deps)}] Worker failed`);
      return 1;
    }

    console.log(`[${stamp(deps)}] Worker completed successfully`);
    console.log(`  Duration: ${(completion.durationMs / 1000).toFixed(1)}s`);
    console.log(`  Tokens: ${String(completion.tokens)}`);
    console.log(
      `WORKER_RESULT:${JSON.stringify({
        sessionKey,
        tokens: completion.tokens,
        durationMs: completion.durationMs,
        model: completion.model,
      })}`,
    );
    return 0;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${stamp(deps)}] Worker failed: ${msg}`);
    return 1;
  }
}

// Run when executed directly (not imported for testing). The exit code is
// set, not forced: the process ends when the event loop drains.
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith('spawn-worker.ts') ||
    process.argv[1].endsWith('spawn-worker.js'));

if (isDirectExecution) {
  workerMain(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.exitCode = 1;
    },
  );
}
