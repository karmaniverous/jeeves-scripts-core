---
name: jeeves-daily-briefings
description: Set up and manage recurring daily briefings. Use when asked to create a daily intelligence report, action-item briefing, end-of-day follow-up, market intel report or stakeholder digest delivered to a Slack channel, or to run one on demand.
metadata: { 'openclaw': { 'requires': { 'env': ['JEEVES_SCRIPTS_DIR'] } } }
---

# Daily Briefings

A daily briefing is a task-file dispatcher job: the job script gives an LLM worker a TASK plus Slack context, the worker writes a dated Markdown report into the content tree, and the job script posts the worker's summary. Core ships the executive family's TASK templates (morning briefing, end-of-day follow-up, market intel), read from the package unless the instance has its own file at the dispatcher's task-file path. Read [dispatchers.md]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/dispatchers.md#daily-briefings) for the format, the shared rules and an example.

## Operator rules

- **Workers have no `message` tool.** The job script reads and posts Slack; a TASK never tells the worker to use it. The summary's shape is job-script config (`briefingSummaryPurpose`): emoji and bold title with the date, 3-5 BLUF bullets, the link to the full report, never the document.
- **Feedback channel = delivery channel.** Status or error notes go to the operator only.
- **Standing orders are memory:** each report keeps an append-only `standing-orders.md`; feedback becomes a new dated entry, never an edit. **Cleared Items** never resurface.
- **Carry forward across the morning briefing and the end-of-day list**, and reconcile their checkboxes (more recent wins; checkboxes beat chat).
- **Validate links** in market intel (it may leave the organisation); drop sources that don't resolve.
- **Use the dispatcher's date** in the principal's zone; never guess today's date.

## Setting one up

1. Per report, a content directory (right silo) with `standing-orders.md` started from [the seed]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/task-templates/daily-briefings/standing-orders.seed.md); seed its `.meta/` with `meta_seed` and set `_steer` to [the steer]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/task-templates/daily-briefings/meta-steer.md)'s text.
2. A dispatcher runnable per report in the instance (`taskFileDispatcher` with `template: BRIEFING_TEMPLATES.<report>`, `templateVars: () => briefingVars({...})` with every directory absolute (the end-of-day and market-intel reports need their own `eodDir` / `marketIntelDir`), `dateTimeZone`, and `slack` reads and posts), registered by the instance plugin, with a manifest (or none, for on-demand only); commit and push (see `jeeves-scripts`).
3. Customise only by copying the template to the task-file path; the run log says which source it used.
4. Test with `--print-task` and `--dry-run`, then enable it. On demand: `run <id>` when the principal asks; run that way (not by the runner), the task says `This run is on-demand` and the report covers everything since the latest one.

Briefings read email and calendars from the pipeline archives (watcher search), not Google directly; see `jeeves-email` and `jeeves-calendar`.
