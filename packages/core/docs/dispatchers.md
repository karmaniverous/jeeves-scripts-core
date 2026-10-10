# dispatchers/

Framework for autonomous LLM task dispatchers that read Markdown task files and spawn gateway sessions to execute them. This is the mechanism behind daily briefings, social media content generation, and other standing-order operations.

## Scripts

| Script | Description |
| --- | --- |
| `daily-digest.ts` | Job `generate-daily-digest`. The reference task-file dispatcher: reads `digest/TASK.md` in the default silo and dispatches a gateway session to generate and publish a daily digest, through `taskFileDispatcher` (below). Injects authoritative date context in the zone set by the `digest.timezone` ref (IANA name, e.g. `America/Chicago`, or `UTC`). The worker may post to the optional `slack.digestChannel` / `slack.operatorDm` refs (no Slack reads; `lib/digest-targets.ts`). No TASK file: `[skip]`; once it exists, `digest.timezone` is required (missing or invalid fails the run; there is no default). |
| `social-posts.ts` | Job `generate-social-posts`. Builds a task from `pipeline.refs` and content paths, then dispatches a session to generate social media posts to a Notion database; the script posts the worker's summaries to Slack. Prerequisites: the `notion.socialPostsDatabaseId`, `slack.socialChannel` and `slack.operatorDm` refs (Slack IDs). |
| `lib/task-file-dispatcher.ts` | `taskFileDispatcher` / `dispatchTaskFile` / `resolveTaskFile`: the generic task-file dispatcher, exported from the package root (below). |

## Activation

Dispatchers are not in the template's `jobs/` manifests, because each instance's dispatcher configuration (task content, schedule, channels) is unique. To activate one:

1. Meet its prerequisites (see each script's module-level TSDoc).
2. Task-file dispatchers (`daily-digest`): write the TASK file with your standing orders. Dynamic dispatchers (`social-posts`): set the required `pipeline.refs` in `jeeves-scripts.json`.
3. Add a manifest entry to the instance's `jobs/*.json`: `{ "id": "generate-daily-digest", "script": "src/dispatchers/daily-digest.ts", "schedule": "...", ... }`, with the schedule as an RRStack JSON string (e.g. `{"freq":"daily","byhour":6,"byminute":30,"timezone":"America/Chicago"}`) or a cron expression. The runner job runs `bin/jeeves-scripts.js` with args `["run", "<job-id>"]` (see [cli](./cli.md)); `run` maps the script path into core's build unless the instance repo has its own file there.
4. Test with `--print-task`, then `--dry-run` (below), before enabling the job: `node bin/jeeves-scripts.js run generate-daily-digest --print-task`.

## Slack: the job script does it, not the worker

On OpenClaw 2026.9, sub-agent sessions (runner LLM workers) have **no `message` tool**, so a worker cannot read or post Slack. Every dispatcher that needs Slack uses `dispatchWithSlack` (`../lib/worker-slack/`):

1. **Reads:** before dispatch, the script reads the configured channels/threads through the gateway `message` tool and appends them to the TASK under "Slack context". Each read is `{ target, label, limit?, threadTs? }`: `label` is what the worker sees (e.g. `#ops`), `limit` is 1-200 messages (default 20), and `threadTs` reads that thread instead of the channel. The Slack context is fenced as untrusted data the worker must never follow as instructions.
2. **Posts:** the TASK ends with the output contract. The worker returns its intended posts in one fenced `slack-posts` block (JSON array of `{channel, text, thread_ts?, pin?, edit_ts?}`, `[]` for none; `edit_ts` replaces an existing message's text). The script validates the whole block, checking every target against the job's allowlist and every operation against that target's permissions (`editTs`: the exact message ids it may edit; `pin: true`: it may pin), then posts (and pins / edits) them itself. An invalid block, a disallowed target, or an edit/pin the target does not permit posts nothing and fails the job. The Slack config itself is validated with a Zod schema (`worker-slack-config.ts`) before any gateway call, and a read whose response lacks a valid `messages` array fails the job instead of being treated as an empty channel.
3. **Flags:** `--dry-run` dispatches but prints the posts instead of posting. `--print-task` reads Slack, prints the full TASK and stops without dispatching.

Pass `accountId` in the Slack config (the gateway's Slack account id, `[A-Za-z0-9_-]{1,64}`) when the gateway has several Slack accounts. TASK text must never tell the worker to use the message tool; describe _what_ to post and _where_ (by purpose) and let the contract do the rest. Targets are Slack IDs (`C…`, `G…`, `D…` channels; `U…`, `W…` users) or prefixed targets (`channel:…`, `user:…`), never `#names`. Each post target may appear once (`C…` and `channel:C…` count as the same target).

```typescript
await dispatchWithSlack(
  task,
  { jobId: 'my-job', thinking: 'low', timeout: 600 },
  {
    reads: [{ target: 'C000EXAMPLE1', label: '#ops-ceo', limit: 30 }],
    posts: [
      {
        target: 'C000EXAMPLE1',
        purpose: "today's agenda (pin it), plus the quick-links edit",
        pin: true,
        editTs: ['1789000000.000100'], // the pinned quick-links message only
      },
    ],
  },
);
```

## Creating a New Dispatcher

### Task-file dispatcher (reads a TASK.md file)

Use `taskFileDispatcher` (exported from `@karmaniverous/jeeves-scripts-core`). It reads `<silo>/<taskFile>` (`siloPath`, Decision 28; `silo` omitted = the default silo), `[skip]`s with exit 0 when the file is missing, optionally prefixes the date, and dispatches through `dispatchWithSlack` (with `slack`) or jeeves-runner's `runDispatcher` and core's `spawn-worker` (without). `jobs.<jobId>.silo` / `.taskFile` in `jeeves-scripts.json` override the values in code, so an instance can move a TASK without code.

```typescript
import { getRef, taskFileDispatcher } from '@karmaniverous/jeeves-scripts-core';

taskFileDispatcher({
  scriptName: 'my-domain/briefing', // runScript crash-handler name
  jobId: 'my-briefing',
  thinking: 'low',
  silo: 'client', // optional; a configured silo name
  taskFile: 'briefing/TASK.md', // relative to the silo
  dateTimeZone: 'America/New_York', // optional; string or () => string
  slack: () => ({
    posts: [{ target: getRef('slack.briefingChannel'), purpose: 'the briefing' }],
  }), // optional; value or () => value, evaluated inside the run
});
```

`dateTimeZone` and `slack` may be functions so that config errors (a missing ref, an invalid zone) fail the run through `runScript` instead of at import. `dispatchTaskFile(options, deps?)` is the same body without `runScript`, returning `'skipped'` or `'dispatched'`; its `deps` (`dispatchWithSlack`, `runDispatcher`, `now`, `log`) are injectable for tests.

### Dynamic Task Dispatcher (builds task at runtime)

Pattern from `social-posts.ts`: build task text from `pipeline.refs`:

```typescript
import { runScript } from '@karmaniverous/jeeves';
import { tryGetRef } from '@karmaniverous/jeeves-scripts-core';
import { dispatchWithSlack } from '@karmaniverous/jeeves-scripts-core/lib/worker-slack/run';

runScript('dispatchers/my-dispatcher', async () => {
  const channel = tryGetRef('slack.myChannel');
  if (!channel) {
    console.log(
      '[skip] Not configured: set pipeline.refs["slack.myChannel"] in jeeves-scripts.json',
    );
    return;
  }

  const task = 'Do the work, then return a results summary as a Slack post.';

  await dispatchWithSlack(
    task,
    { jobId: 'my-job', thinking: 'low' },
    { posts: [{ target: channel, purpose: 'the results summary' }] },
  );
});
```

### Pinned Quick-Links Message

A job (or a pair of jobs, e.g. meeting notes and agenda) can keep one pinned message in a channel current with links to the latest output:

1. Post the message once, pin it, and record its timestamp.
2. Allow exactly that timestamp on the channel's post target: `editTs: ['<ts>']`. Grant `pin: true` only if the job also pins new messages.
3. Each run's TASK asks for an entry with `edit_ts` set to that timestamp; the script replaces the message's text. Any other `edit_ts` fails the job.

To read manual overrides or feedback from the same channel, add it to `reads`.

### Date Context Injection

When a dispatcher needs an authoritative date reference (e.g. daily digests), inject it as a quoted block at the top of the task, so the worker never guesses the date. Use the stakeholder's time zone from instance config, never a hard-coded default: `daily-digest.ts` reads the `digest.timezone` ref (`lib/digest-timezone.ts`). With `taskFileDispatcher`, pass `dateTimeZone`; otherwise `requireTimeZone` (`lib/dates`) throws when the value is missing or not a valid zone, and `withDateContext` prepends the date line:

```typescript
import { tryGetRef } from '@karmaniverous/jeeves-scripts-core';
import { requireTimeZone, withDateContext } from '@karmaniverous/jeeves-scripts-core/lib/dates';

const tz = requireTimeZone(
  tryGetRef('myDomain.timezone'),
  'pipeline.refs["myDomain.timezone"] in jeeves-scripts.json',
);
task = withDateContext(task, new Date(), tz);
// > **Today is Monday, 2026-05-11 (America/Chicago).** Use this as the authoritative date reference for all dates in this report.
```

## TASK File Anatomy

A TASK file is a Markdown document containing standing orders for an LLM session. It defines:

- **What to do**: the goal of the session (generate a digest, write social posts, etc.)
- **Data sources**: which files/directories/APIs to read
- **Output destinations**: where to write results (Notion, Slack, filesystem)
- **Rules and constraints**: content guidelines, formatting requirements, routing instructions

TASK files are instance content, in a silo (Decision 23), e.g. `{contentDir}/digest/TASK.md`.

## Prerequisites

- Gateway API reachable on loopback at the OpenClaw config's `gateway.port`, token from the same config (`lib/openclaw-config`)
- Per-dispatcher prerequisites documented in each script's module-level TSDoc

## Key Files

| File | Purpose |
| --- | --- |
| `lib/task-file-dispatcher.ts` | `taskFileDispatcher`, `dispatchTaskFile`, `resolveTaskFile` |
| `lib/digest-timezone.ts` | Reads and validates the daily digest's `digest.timezone` ref |
| `lib/digest-targets.ts` | The daily digest's allowed Slack targets |
| `../config/pipeline-accessors.ts` | `getRef()` / `tryGetRef()` for refs |
| `../config/silo-router.ts` | `siloPath()` for task file locations |
| `../lib/dates.ts` | `requireTimeZone()` / `withDateContext()` for date context injection |
| `../lib/spawn-worker.ts` | Gateway session spawner run by `runDispatcher()` / `dispatchSession()` (`constants().SPAWN_WORKER_PATH`) |
| `../lib/worker-slack/` | Job-side Slack I/O for workers: reads, `slack-posts` contract, posting |
