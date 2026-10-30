---
name: jeeves-jira
description: Jira integration - webhook drain, backfill, field refresh, backlog sort, ticket creation conventions, Blocks link direction, and editing or restructuring tickets. Use when working with the Jira pipeline or archive, creating or linking Jira tickets, or editing ticket descriptions.
metadata: { "openclaw": { "requires": { "env": ["JEEVES_SCRIPTS_DIR"] } } }
---

# Jira

Read [jira.md]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/jira.md) for how the Jira pipeline works: webhook drain, archive layout and entity format, custom fields, backfill, backlog sort and the event gateway route.

## Prerequisites

- Site, email, token file and board are `integrations.jira` in `jeeves-scripts.json` ([config.md]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/config.md)). The token is a file in the credentials folder, never a config value or a repo file.
- Webhooks reach the drain through the jeeves-server Event Gateway ([Event Gateway Config]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/jira.md#event-gateway-config)). The route lives in the instance's server config: ask the operator to change it rather than editing the live file.

## Ticket creation conventions

When creating Jira tickets from assistant context (Slack messages, meeting action items):

- **Attachments are mandatory** when the source includes files, images or documents: attach them, don't just reference them.
- Use the project key the routing config gives for the source.
- Map priority from context (urgent or blocking → High, otherwise Medium).
- Put the source (Slack link, meeting reference) in the description.

## Links

"Blocks" links go in the wrong direction easily: the REST field names suggest the opposite of what they do. Make the check mechanical:

1. **State the dependency in words first:** "A must be finished before B can start." The prerequisite is the blocker. Design, question and spike tickets usually block their build or implementation tickets, not the other way round.
2. **Write it as "A blocks B"**, in proposals and triage docs too, so the direction can be checked at review.
3. **Create it with the blocker in `inwardIssue`:** `POST /rest/api/3/issueLink` with `{"type":{"name":"Blocks"},"inwardIssue":{"key":"A"},"outwardIssue":{"key":"B"}}`.
4. **Read it back from both issues before reporting it done:** `GET /rest/api/3/issue/<key>?fields=issuelinks` on each; A must show "blocks B" and B must show "is blocked by A". If a ticket description or triage row names the blocker, check the link against it.

## Editing and restructuring tickets

Editing part of an ADF description, merging or closing tickets, and fixing links in bulk: follow [Editing and restructuring tickets]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/jira.md#editing-and-restructuring-tickets) (backup, map, smallest splice, diff, read back; one dry-run script for bulk changes).
