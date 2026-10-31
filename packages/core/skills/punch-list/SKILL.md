---
name: punch-list
description: The instance's punch list of platform work. Use when anyone asks for a capability, fix or change to this assistant or its platform, when adding, ticking or reading punch-list items or milestones, or when working with the punch-list runnables.
metadata: { 'openclaw': { 'requires': { 'env': ['JEEVES_SCRIPTS_DIR'] } } }
---

# Punch List

One Markdown file per day, `{punchList.dir}/YYYY-MM-DD.md` (the instance config's `punchList.dir`; the newest file is the live one), kept by `punch-list-refresh-status` and `punch-list-harvest`. Read [punch-list.md]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/punch-list.md) for the format, the runnables and the config.

## Sections and items

- **Tasks** and **Backlog**: checkbox entries, `- [ ] **Title** — details · added YYYY-MM-DD`. The next write adds an id (`t-…`, `b-…`); keep the text as written.
- **TODO**, **Done**, **Integrated**: milestones, `### <slug> — Title` with free prose. Don't edit the `- Issues:`, `- Releases:` or `- Installed:` lines; the status checker rewrites them.
- **Completed Tasks**, **Processed Backlog Items**: finished entries.

## Statuses

- Tick a task: it moves to Completed Tasks. Tick a backlog item once it is promoted to a milestone, done or rejected: it moves to Processed.
- A milestone moves TODO → Done by itself when all its GitHub issues shipped, and back if one reopens. Tick `Integrated` on a Done milestone once it is verified: it moves to Integrated. Untick to send anything back.

## Adding an item (any session, any channel)

1. Open today's file (if today's doesn't exist yet, the newest; the next run rolls it over).
2. Append to Backlog: `- [ ] **<Title>** — <why> · requested by <name> · <link to the message or file> · added <YYYY-MM-DD>`, or to Tasks for work already agreed. One line, no id.
3. Save it. If the file changed under you, re-read it and add again; never overwrite someone else's edit.

## Milestones

A milestone's slug is the title of the GitHub milestone holding its issues, in the scripts repo or a repo in `punchList.installMap`. Prefix the instance name (`<instance>-<topic>`); core doesn't enforce it. Add the `### <slug> — Title` block to TODO when the milestone exists.

## Harvesting

`punch-list-harvest` files requested and inferred platform work to the Backlog daily. Its standard: platform work only, one item per need, nothing already on the list, and every item cites a source (an archive file or a runner/watcher/meta reference). Hand-added items should meet it too. An instance's own `{punchList.dir}/TASK.md` replaces core's harvest instructions; `run punch-list-harvest --print-task` shows which is used.
