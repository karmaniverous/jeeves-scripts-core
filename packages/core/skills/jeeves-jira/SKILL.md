---
name: jeeves-jira
description: Jira integration - webhook drain, backfill, field refresh, backlog sort, and ticket creation conventions. Use when working with the Jira pipeline or archive, or creating Jira tickets from assistant context.
---

# Jira

Read [jira.md](../../guides/jira.md) for how the Jira pipeline works: webhook drain, archive layout and entity format, custom fields, backfill, backlog sort and the event gateway route.

## Prerequisites

- Site, email, token file and board are `integrations.jira` in `jeeves-scripts.json` ([config.md](../../guides/config.md)). The token is a file in the credentials folder, never a config value or a repo file.
- Webhooks reach the drain through the jeeves-server Event Gateway ([Event Gateway Config](../../guides/jira.md#event-gateway-config)). The route lives in the instance's server config: ask the operator to change it rather than editing the live file.

## Ticket creation conventions

When creating Jira tickets from assistant context (Slack messages, meeting action items):

- **Attachments are mandatory** when the source includes files, images or documents: attach them, don't just reference them.
- Use the project key the routing config gives for the source.
- Map priority from context (urgent or blocking → High, otherwise Medium).
- Put the source (Slack link, meeting reference) in the description.
