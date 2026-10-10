---
name: jeeves-calendar
description: Google Calendar event polling and meeting coordination. Use when working with the calendar pipeline, setting up gog for Google Calendar, or scheduling meetings.
---

# Calendar

Read [calendar.md](../../docs/calendar.md) for how the calendar pipeline works: jobs, account configuration, data flow and output layout.

## Operator rules

- **Accounts are config:** which calendars are polled is the `pipeline` accounts list in `jeeves-scripts.json` ([config.md](../../docs/config.md#the-pipeline-block)). Ask the operator before adding one.
- **Answer from the archive** the pipeline writes (or watcher search over it); use gog directly only for live, interactive lookups.
- **Scheduling acts for people:** propose times, but send or accept an invite only on an explicit request.

## gog

- Calendar goes through the `gog` CLI; when it is installed, its skills (`gog-calendar`, `gog-auth`) cover command details.
- If a mailbox the pipeline needs isn't registered with gog, ask the operator to register it rather than copying keys around yourself.
