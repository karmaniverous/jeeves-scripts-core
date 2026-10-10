---
name: jeeves-standing-meetings
description: Automate standing meeting operations - post-meeting notes and next-day agenda generation. Use when asked to set up meeting automation for a recurring standup, sync, or review.
---

# Standing Meetings

Two task-file dispatcher jobs for a recurring meeting between known participants: a **notes** job (hourly in business hours on meeting days; finds today's meeting and transcript, writes structured notes, idempotent once today's notes exist) and an **agenda** job (once, early on meeting days; reads the last notes and agenda, reconciles checkboxes, writes the next agenda). Each returns a Slack summary, and both keep one pinned quick-links message current. Read [dispatchers.md](../../docs/dispatchers.md) for the framework, the TASK file anatomy and the Slack contract (posts, pins, edits); transcripts come from the meetings pipeline ([meetings.md](../../docs/meetings.md)).

## Operator rules

- **Workers have no `message` tool.** The job script reads the meeting channel (manual overrides, feedback) and posts, pins and edits for the worker; a TASK file never tells the worker to use it.
- **Detect by participants, not title:** titles change, participants don't. A participant's override in the channel ("that 2pm call was our standup") beats detection.
- **Stop quietly** when no meeting is on the calendar today or it hasn't finished yet.
- **Checkbox state wins:** unchecked items under Completed reopen; checked open items move to Completed.
- **Pinned quick-links:** post and pin it once, record its timestamp; the dispatchers may edit exactly that message.
- **Time zones:** standing orders record each participant's zone; give times in both, and use the dispatcher's date in the meeting's zone (see `jeeves-dates`).
- **Standing orders are append-only** memory beside the notes and agendas.

## Setting one up

1. A content directory (in the right silo) with `standing-orders.md` (participants, zones, channel rules); seed `.meta/` with `meta_seed`.
2. TASK files for both jobs, following the anatomy in dispatchers.md.
3. The quick-links message: post, pin, record its timestamp.
4. Two dispatcher jobs (core's task-file dispatcher, with `silo` and `taskFile`) in `jobs/*.json`, Slack reads of the channel and posts allowed to edit the quick-links message; commit and push (see `jeeves-scripts`).
5. Register both with the runner, running the launcher (`run <job-id>`), in the meeting's time zone; test with the no-post mode before enabling.
