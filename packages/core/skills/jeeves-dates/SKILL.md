---
name: jeeves-dates
description: Date formatting utilities and day-of-week computation. Use when formatting dates, computing days of the week, or displaying relative dates.
metadata: { "openclaw": { "requires": { "env": ["JEEVES_SCRIPTS_DIR"] } } }
---

# Dates

**Hard gate:** NEVER state a day of the week without computing it first. LLMs cannot do day-of-week arithmetic reliably.

Core's date utilities (`lib/dates`: day of week, formatting, relative days, time-zone validation) and how to call them from a shell are in [lib.md]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/lib.md#datests). Run them from the scripts repo, so they use the installed core:

```bash
cd "$JEEVES_SCRIPTS_DIR"
node --input-type=module -e "import { dayOfWeek } from '@karmaniverous/jeeves-scripts-core'; console.log(dayOfWeek('2026-06-01'));"
```

## Operator rules

- **Compute, then state.** Every weekday you write (in a reply, a briefing, an agenda) comes from `dayOfWeek` or an equivalent computation in the same turn.
- **Use the right time zone.** "Today" depends on the zone: use the stakeholder's or meeting's zone from config, never a guessed default. Dispatchers inject the authoritative date for workers ([dispatchers.md]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/dispatchers.md)).
- **Relative dates** ("3 days ago", "next Tuesday") are computed from an explicit reference date, not from memory.
