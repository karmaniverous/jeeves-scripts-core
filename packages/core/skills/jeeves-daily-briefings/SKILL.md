---
name: jeeves-daily-briefings
description: Set up and manage recurring daily briefings. Use when asked to create a daily intelligence report, action-item briefing, or stakeholder digest delivered to a Slack channel.
---

# Daily Briefings

A daily briefing is a task-file dispatcher job: on schedule, the job script gives an LLM worker a TASK file plus Slack context, the worker writes a dated Markdown briefing into the content tree, and the job script posts the worker's summary (with an insider link to the full document) to the delivery channel. Read [dispatchers.md](../../guides/dispatchers.md) for the framework, the TASK file anatomy and how to create one.

## Operator rules

- **Workers have no `message` tool.** The job script reads and posts Slack ([Slack: the job script does it](../../guides/dispatchers.md#slack-the-job-script-does-it-not-the-worker)). A TASK file never tells the worker to use it; it says what to post and for which purpose.
- **Feedback channel = delivery channel.** Read stakeholder replies where the briefing is posted; if the job also reads a DM, read both.
- **Standing orders are memory:** keep an append-only `standing-orders.md` beside the briefings; feedback becomes a standing order, never an edit of an old one.
- **Validate links** in external-facing briefings before posting; drop sources that don't resolve.
- **Use the dispatcher's date** in the stakeholder's time zone; never guess today's date.
- **Action-item briefings** reconcile checkbox state from the previous briefing.

## Setting one up

1. A content directory for the briefing (in the right silo) with `standing-orders.md`; seed its `.meta/` with `meta_seed`.
2. The TASK file, following the anatomy in dispatchers.md.
3. A dispatcher job (core's task-file dispatcher, with `silo` and `taskFile`), added to `jobs/*.json` and, where the operator wants overrides, `jobs.<id>` in `jeeves-scripts.json`; commit and push (see `jeeves-scripts`).
4. Register it with the runner, running the launcher (`run <job-id>`), and test with the dispatcher's no-post mode before enabling it.

Briefings that need email or calendars read the pipeline archives (watcher search), not Google directly; see `jeeves-email` and `jeeves-calendar`.
