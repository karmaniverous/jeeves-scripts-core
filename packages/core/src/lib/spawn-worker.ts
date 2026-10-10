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
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
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
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < SPAWN_MAX_RETRIES; attempt++) {
    try {
      const result = await deps.invoke(
        'sessions_spawn',
        spawnArgs as unknown as Record<string, unknown>,
      );

      // Check for gateway timeout in the response body text
      const resultText = JSON.stringify(result);
      if (/gateway timeout/i.test(resultText)) {
        lastError = new Error('gateway timeout in response body');
        if (attempt === SPAWN_MAX_RETRIES - 1) break;
        const waitMs = SPAWN_BACKOFF_BASE_MS * 2 ** attempt;
        console.log(
          `[${new Date().toISOString()}] Spawn attempt ${String(attempt + 1)}/${String(SPAWN_MAX_RETRIES)} failed: gateway timeout in response. Retrying in ${String(waitMs / 1000)}s...`,
        );
        await deps.sleep(waitMs);
        continue;
      }

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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = err instanceof Error ? err : new Error(msg);

      if (/timeout/i.test(msg) && attempt < SPAWN_MAX_RETRIES - 1) {
        const waitMs = SPAWN_BACKOFF_BASE_MS * 2 ** attempt;
        console.log(
          `[${new Date().toISOString()}] Spawn attempt ${String(attempt + 1)}/${String(SPAWN_MAX_RETRIES)} failed: ${msg}. Retrying in ${String(waitMs / 1000)}s...`,
        );
        await deps.sleep(waitMs);
        continue;
      }

      throw lastError;
    }
  }

  throw lastError ?? new Error('Spawn failed after all retries');
}

// ── CLI entry point ───────────────────────────────────────────────────

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args['job-id']) {
    console.error(
      'Usage: echo "task" | node spawn-worker.js --job-id=<id> [--label=<label>] [--thinking=<level>]',
    );
    process.exit(1);
  }

  const taskInput = await readStdin();
  if (!taskInput) {
    console.error('Error: No task provided on stdin');
    process.exit(1);
  }

  const jobId = args['job-id'];
  const startTime = Date.now();
  const spawnArgs: SpawnArgs = {
    task: taskInput,
    label: args.label ?? `worker-${jobId.slice(0, 8)}`,
    thread: false,
  };

  if (args.thinking) {
    spawnArgs.thinking = args.thinking;
  }

  console.log(
    `[${new Date().toISOString()}] Spawning worker for job ${jobId.slice(0, 8)}`,
  );
  console.log(`  Label: ${spawnArgs.label}`);

  try {
    const { result, sessionKey } = await spawnWithRetry(spawnArgs);
    console.log(`[${new Date().toISOString()}] Worker spawned successfully`);
    console.log(
      `[${new Date().toISOString()}] Raw spawn result: ${JSON.stringify(result).slice(0, 500)}`,
    );

    console.log(
      `[${new Date().toISOString()}] Waiting for worker to complete (session: ${sessionKey})...`,
    );

    const completion = await waitForWorkerCompletion(sessionKey, startTime);

    if (!completion.success) {
      console.error(`[${new Date().toISOString()}] Worker failed`);
      process.exit(1);
    }

    console.log(`[${new Date().toISOString()}] Worker completed successfully`);
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

    process.exit(0);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${new Date().toISOString()}] Worker failed: ${msg}`);
    process.exit(1);
  }
}

// Run main when executed directly (not imported for testing)
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith('spawn-worker.ts') ||
    process.argv[1].endsWith('spawn-worker.js'));

if (isDirectExecution) {
  main().catch(() => process.exit(1));
}
