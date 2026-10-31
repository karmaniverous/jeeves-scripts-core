---
title: Dispatchers
---

# dispatchers/

Framework for autonomous LLM task dispatchers that read Markdown task files and spawn gateway sessions to execute them. This is the mechanism behind daily briefings, social media content generation, and other standing-order operations.

## Scripts

| Script | Description |
| --- | --- |
| `lib/digest-timezone.ts` | `digestTimeZone()` / `DIGEST_TIMEZONE_REF`: reads and validates the `digest.timezone` ref (IANA name, e.g. `America/Chicago`, or `UTC`); a missing or invalid zone throws (there is no default). For an instance's own digest. |
| `lib/task-file-dispatcher.ts` | `taskFileDispatcher` / `dispatchTaskFile` / `resolveTaskFile`: the generic task-file dispatcher, exported from the package root (below). |
| `lib/briefing.ts` | `BRIEFING_TEMPLATES`, `briefingVars` / `briefingVarsSchema`, `briefingSummaryPurpose`: the daily-briefing family's core templates, their values and the Slack summary shape ([daily briefings](#daily-briefings)). |

## Activation

Core ships no dispatcher runnable: a daily digest or briefing is an instance's choice of what to summarise and where to post it, so it is instance code (Decision 44). Core provides the machinery below. To add a dispatcher to an instance:

1. Write it as an instance runnable with `defineRunnable`, in an instance domain, registered by the instance plugin ([runnables](./runnables.md#instance-runnables-and-overrides)), calling `dispatchTaskFile` (below) or building its task at runtime.
2. Task-file dispatchers: write the TASK file with your standing orders. Dynamic dispatchers: set the `pipeline.refs` they read in the instance config.
3. Give it a manifest in the instance's `jobs/*.json` (see [runnables](./runnables.md#manifests)) so the runner can schedule it as `["run", "<id>"]`, on a jeeves-runner schedule (e.g. `{"freq":"daily","byhour":6,"byminute":30,"timezone":"America/Chicago"}`).
4. Test with `--print-task`, then `--dry-run`, before enabling it: `node bin/jeeves-scripts.js run acme-generate-digest --print-task`. Both flags work for every `dispatchTaskFile` dispatcher: `--print-task` prints the full TASK and dispatches nothing; `--dry-run` reports what it would dispatch (job, task length and, with `slack`, the allowed post targets) and dispatches nothing. Neither flag ever starts a worker session, with or without `slack`. Either way `dispatchTaskFile` resolves `'previewed'`. Declare them with `flags: dispatcherFlags` (root export) on the dispatcher's `defineRunnable`: `run` then rejects any other option, and `taskFileDispatcher` passes the parsed `ctx.flags` on as `options.flags` (each must be a boolean, else a `TypeError`). A dispatcher that declares no flags still works: `dispatchTaskFile` reads them from `options.args` (`taskFileDispatcher` passes `ctx.args`), or from `process.argv` when it gets neither. `dispatchWithSlack` takes the same parsed flags or raw arguments as its fourth parameter.

## Slack: the job script does it, not the worker

On OpenClaw 2026.9, sub-agent sessions (runner LLM workers) have **no `message` tool**, so a worker cannot read or post Slack. Every dispatcher that needs Slack uses `dispatchWithSlack` (`../lib/worker-slack/`):

1. **Reads:** before dispatch, the script reads the configured channels/threads through the gateway `message` tool and appends them to the TASK under "Slack context". Each read is `{ target, label, limit?, threadTs? }`: `label` is what the worker sees (e.g. `#ops`), `limit` is 1-200 messages (default 20), and `threadTs` reads that thread instead of the channel. The Slack context is fenced as untrusted data the worker must never follow as instructions.
2. **Posts:** the TASK ends with the output contract. The worker returns its intended posts in one fenced `slack-posts` block (JSON array of `{channel, text, thread_ts?, pin?, edit_ts?}`, `[]` for none; `edit_ts` replaces an existing message's text). The script validates the whole block, checking every target against the job's allowlist and every operation against that target's permissions (`editTs`: the exact message ids it may edit; `pin: true`: it may pin), then posts (and pins / edits) them itself. An invalid block, a disallowed target, or an edit/pin the target does not permit posts nothing and fails the job. The Slack config itself is validated with a Zod schema (`worker-slack-config.ts`) before any gateway call, and a read whose response lacks a valid `messages` array fails the job instead of being treated as an empty channel.
3. **Flags:** `--dry-run` reads Slack, builds the TASK, prints a one-line report (job, TASK length, allowed post targets) and stops: no worker session, no posts. `--print-task` reads Slack, prints the full TASK and stops without dispatching.

Pass `accountId` in the Slack config (the gateway's Slack account id, `[A-Za-z0-9_-]{1,64}`) when the gateway has several Slack accounts. TASK text must never tell the worker to use the message tool; describe _what_ to post and _where_ (by purpose) and let the contract do the rest. Targets are Slack IDs (`C…`, `G…`, `D…` channels; `U…`, `W…` users) or prefixed targets (`channel:…`, `user:…`), never `#names`. Each post target may appear once (`C…` and `channel:C…` count as the same target).

```typescript
await dispatchWithSlack(
  task,
  { jobId: 'my-job', thinking: 'low', timeout: 600 },
  {
    reads: [{ target: 'C000EXAMPLE1', label: '#acme-ops', limit: 30 }],
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

Use `dispatchTaskFile` inside a runnable, or pass `taskFileDispatcher(options)` (a `run` function that calls it) to `defineRunnable`, both exported from `@karmaniverous/jeeves-scripts-core`. It reads `<silo>/<taskFile>` (`siloPath`, Decision 28; `silo` omitted = the default silo), `[skip]`s with exit 0 when the file is missing, optionally prefixes the date, and dispatches through `dispatchWithSlack` (with `slack`) or jeeves-runner's `runDispatcher` and core's `spawn-worker` (without). `jobs.<jobId>.silo` / `.taskFile` in the instance config override the values in code, so an instance can move a TASK without code. Every run logs where its task came from (`<scriptName>: task from the instance file <path>`).

```typescript
import {
  defineRunnable,
  dispatchTaskFile,
  getRef,
} from '@karmaniverous/jeeves-scripts-core';

export default defineRunnable({
  id: 'acme-generate-briefing',
  domain: 'acme',
  description: 'Dispatch the daily briefing task.',
  run: async () => {
    await dispatchTaskFile({
      scriptName: 'acme/briefing', // label in the [skip] line
      jobId: 'acme-generate-briefing',
      thinking: 'low',
      silo: 'client', // optional; a configured silo name
      taskFile: 'briefing/TASK.md', // relative to the silo
      dateTimeZone: 'America/New_York', // optional; string or () => string
      slack: () => ({
        posts: [
          { target: getRef('slack.briefingChannel'), purpose: 'the briefing' },
        ],
      }), // optional; value or () => value, evaluated inside the run
    });
  },
});
```

`dateTimeZone` and `slack` may be functions so that config errors (a missing ref, an invalid zone) fail the run through `runScript` instead of at import. `dispatchTaskFile(options, deps?)` is the same body without `runScript`, returning `'skipped'` or `'dispatched'`; its `deps` (`dispatchWithSlack`, `runDispatcher`, `now`, `log`) are injectable for tests.

### Dynamic Task Dispatcher (builds task at runtime)

An instance runnable that builds its task text at runtime from `pipeline.refs` (instance code, registered by the plugin):

```typescript
import {
  defineRunnable,
  dispatchWithSlack,
  tryGetRef,
} from '@karmaniverous/jeeves-scripts-core';

export default defineRunnable({
  id: 'acme-generate-summary',
  domain: 'acme',
  description: 'Dispatch a worker to write the results summary.',
  // tryGetRef returns '' (never undefined) for a missing ref.
  prerequisite: () =>
    tryGetRef('slack.myChannel') !== '' ||
    'set pipeline.refs["slack.myChannel"] in the instance config',
  run: async () => {
    const channel = tryGetRef('slack.myChannel');
    const task = 'Do the work, then return a results summary as a Slack post.';
    await dispatchWithSlack(
      task,
      { jobId: 'acme-generate-summary', thinking: 'low' },
      { posts: [{ target: channel, purpose: 'the results summary' }] },
    );
  },
});
```

### Pinned Quick-Links Message

A job (or a pair of jobs, e.g. meeting notes and agenda) can keep one pinned message in a channel current with links to the latest output:

1. Post the message once, pin it, and record its timestamp.
2. Allow exactly that timestamp on the channel's post target: `editTs: ['<ts>']`. Grant `pin: true` only if the job also pins new messages.
3. Each run's TASK asks for an entry with `edit_ts` set to that timestamp; the script replaces the message's text. Any other `edit_ts` fails the job.

To read manual overrides or feedback from the same channel, add it to `reads`.

### Date Context Injection

When a dispatcher needs an authoritative date reference (e.g. daily digests), inject it as a quoted block at the top of the task, so the worker never guesses the date. Use the stakeholder's time zone from instance config, never a hard-coded default: `digestTimeZone()` reads the `digest.timezone` ref (`lib/digest-timezone.ts`). With `taskFileDispatcher`, pass `dateTimeZone`; otherwise `requireTimeZone` (`lib/dates`) throws when the value is missing or not a valid zone, and `withDateContext` prepends the date line:

```typescript
import {
  requireTimeZone,
  tryGetRef,
  withDateContext,
} from '@karmaniverous/jeeves-scripts-core';

const tz = requireTimeZone(
  tryGetRef('myDomain.timezone'),
  'pipeline.refs["myDomain.timezone"] in the instance config',
);
task = withDateContext(task, new Date(), tz);
// > **Today is Monday, 2026-05-11 (America/Chicago).** Use this as the authoritative date reference for all dates in this report.
```

### Core TASK templates

Core ships TASK templates under `task-templates/` in the package (the punch-list harvest, the daily-briefing family). One resolver, `resolveTaskTemplate` (`lib/task-template.ts`, root export), decides which text a worker gets (Decision 75): the instance's own file at the configured path when it exists, else core's copy, read from the package. Nothing copies a template into the instance, so a core update reaches every instance that has not written its own. Every caller logs which source it used (`describeTaskSource`): `task from the instance file <path>` or `task from core template <name> (no instance file at <path>)`. A core template or `{{> name}}` include name is a relative path inside `task-templates/`: an absolute, UNC or drive-qualified name, a `..` segment, or a name that resolves outside the directory (through a link too) fails the run, so no name can put another file into a worker's task.

Give `dispatchTaskFile` a `template` (a name under `task-templates/`) and a missing task file no longer skips: core's template is the task. `templateVars` (a value or a function) fills the task's `{{name}}` placeholders, and `{{> name}}` includes another core template (one level). A placeholder with no value fails the run, naming every missing one. `{{runMode}}` always has a value: `scheduled` under jeeves-runner (`JR_RUN_ID` set), else `on-demand` (`runModeOf`; a `runMode` in `templateVars` wins). Placeholders are filled only when `template` or `templateVars` is given, so an existing instance TASK file with literal braces is unchanged. To customise a template, copy it from `node_modules/@karmaniverous/jeeves-scripts-core/task-templates/` to the dispatcher's task-file path and edit it; the placeholders keep working.

## Daily briefings

The executive daily-briefing family (Decision 44 still holds: core ships the templates and helpers, the instance writes the dispatchers). Three reports, each its own dispatcher with its own directory, standing orders and `.meta/`, enabled independently:

| Report | Template (`BRIEFING_TEMPLATES`) | When | Audience |
| --- | --- | --- | --- |
| Morning briefing | `morning`: `daily-briefings/morning-briefing.md` | Before the principal's day | Internal: everything the principal owns or waits on, prioritised |
| End-of-day follow-up | `eod`: `daily-briefings/eod-follow-up.md` | About 6 PM | Internal: what today produced and what fell through the cracks |
| Market intel | `marketIntel`: `daily-briefings/market-intel.md` | Shortly before the morning briefing | Shareable outside the organisation: no internal items |

Any of them can run on demand instead of (or as well as) on schedule: give the dispatcher no manifest, or a disabled one, and run it when asked (`run <id>`). The dispatcher tells the worker how the run started through `{{runMode}}`, which the morning and end-of-day templates use: `scheduled` when jeeves-runner started it (the runner sets `JR_RUN_ID` for every job run, so a `runner_trigger` run counts as scheduled too), `on-demand` otherwise (`jeeves-scripts run <id>` from a session). On an on-demand run the templates read the delivery channel since the latest artifact instead of a fixed window.

**What the templates hold:** the morning briefing's dated file (`YYYY-MM-DD-daily-briefing.md`) with BLUF, market-intel highlights, action items by owner and urgency (🔴 urgent, 🟡 awaiting the principal, 🔵 awaiting others, ✅ completed since last time, kept one cycle), upcoming calendar and sources; every action item a checkbox with status, source, headline, detail and owner. The end-of-day list (`YYYY-MM-DD-eod-follow-up.md`): do tonight, first thing tomorrow, this week, handled today, each with a category, a suggested delegate and a suspense date. Market intel: highlights, what's new, competitors, trends, fundraising, strategic implications, sources, every URL validated. The morning briefing and the end-of-day list share one set of rules (`daily-briefings/briefing-rules.md`, included in both):

- **Carry-forward across both artifacts**: the more recent of the latest morning briefing and the latest end-of-day list is the baseline; items in the older one missing from the newer one carry forward too, so a skipped run drops nothing; open items carry until someone marks them complete.
- **Checkbox reconciliation**: an open item checked moves to ✅; a ✅ item unchecked moves back to the open section matching its owner; checkbox state beats chat feedback; when both artifacts hold the same item, the more recent checkbox state wins.
- **Standing orders**: feedback in the delivery channel that states a lasting preference is appended (dated, attributed) to the report's `standing-orders.md`; nothing is ever edited. **Cleared Items** are permanent suppressions: never carried forward, never mentioned. `daily-briefings/standing-orders.seed.md` is the starting content for a new report's file (report structure, content focus, handling rules for recurring noise, Cleared Items).
- **Dates**: the dispatcher's date line in the principal's zone, never inferred.

The briefing directory's `.meta/` synthesis is part of the worker's context; steer it with `daily-briefings/meta-steer.md` (conformance to the standing orders, resurfaced cleared items, the report-size trend), set as the meta's `_steer`.

**The job script, not the worker, posts** ([above](#slack-the-job-script-does-it-not-the-worker)). The summary's shape is job-script config: `briefingSummaryPurpose({ emoji, title, bullets? })` gives a post target's `purpose` that fixes it: the emoji and bold title with the date, 3-5 BLUF bullets (or `bullets`, e.g. `'3-4 highlights'` for market intel), then the jeeves-server link to the full report, never the document itself. Status or error notes go to the operator only: give the operator's DM its own post target with that purpose, and never a stakeholder's.

```typescript
import {
  BRIEFING_TEMPLATES,
  briefingSummaryPurpose,
  briefingVars,
  defineRunnable,
  dispatcherFlags,
  taskFileDispatcher,
} from '@karmaniverous/jeeves-scripts-core';

const values = () =>
  briefingVars({
    org: 'Acme',
    principal: 'Ana',
    delegates: 'Bo (operations), Cy (finance)',
    timeZone: 'America/Chicago',
    deliveryChannel: '#ceo-briefing',
    briefingDir: '/base/content/briefings/daily',
    eodDir: '/base/content/briefings/eod', // omit: the morning briefing reads 'not enabled'
    marketIntelDir: '/base/content/briefings/market-intel',
  });

export default defineRunnable({
  id: 'acme-briefing-morning',
  domain: 'acme',
  description: 'Dispatch the morning briefing.',
  flags: dispatcherFlags,
  run: taskFileDispatcher({
    scriptName: 'acme/briefing-morning',
    jobId: 'acme-briefing-morning',
    thinking: 'low',
    taskFile: 'briefings/daily/TASK.md', // an instance file here wins
    template: BRIEFING_TEMPLATES.morning,
    templateVars: values,
    dateTimeZone: 'America/Chicago',
    slack: {
      reads: [{ target: 'C000EXAMPLE1', label: '#ceo-briefing', limit: 50 }],
      posts: [
        {
          target: 'C000EXAMPLE1',
          purpose: briefingSummaryPurpose({
            emoji: '📋',
            title: 'Acme CEO Daily Briefing',
          }),
        },
      ],
    },
  }),
});
```

`briefingVars` validates the values (every field non-empty, `timeZone` an IANA zone, every directory absolute) and fails the run naming each bad field. `eodDir` and `marketIntelDir` are optional. The morning briefing reads them as `eodSource` / `marketIntelSource`: the directory, or `not enabled` ("this report is off") when unset. The end-of-day and market-intel templates write into their own directory, so running either without it fails the run (`task template needs a value for {{eodDir}}`, or `{{marketIntelDir}}`) instead of writing somewhere made up. Placeholders: `org`, `principal`, `delegates`, `timeZone`, `deliveryChannel`, `briefingDir`, `eodDir`, `marketIntelDir`, `eodSource`, `marketIntelSource` (from `briefingVars`) and `runMode` (from the dispatcher; a `runMode` in `templateVars` wins). The `jeeves-daily-briefings` skill has the setup steps.

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
| `lib/briefing.ts` | The daily-briefing templates, values and summary shape |
| `../lib/task-template.ts` | `resolveTaskTemplate`, `describeTaskSource`, `fillTaskTemplate`, `coreTaskTemplatePath` (Decision 75) |
| core `task-templates/daily-briefings/` | The briefing templates, shared rules, standing-orders seed and `.meta/` steer |
| `lib/digest-timezone.ts` | Reads and validates the `digest.timezone` ref |
| `../config/pipeline-accessors.ts` | `getRef()` / `tryGetRef()` for refs |
| `../config/silo-router.ts` | `siloPath()` for task file locations |
| `../lib/dates.ts` | `requireTimeZone()` / `withDateContext()` for date context injection |
| `../lib/spawn-worker.ts` | Gateway session spawner run by `runDispatcher()` / `dispatchSession()` (`constants().SPAWN_WORKER_PATH`) |
| `../lib/worker-slack/` | Job-side Slack I/O for workers: reads, `slack-posts` contract, posting |
