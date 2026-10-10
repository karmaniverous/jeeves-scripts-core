---
name: jeeves-github
description: GitHub integration - repo sync, issue sync, notifications, and collaborator management. Use when working with the GitHub pipeline, debugging GitHub sync, or using the gh CLI as the instance's bot.
---

# GitHub

Read [github.md](../../docs/github.md) for how the GitHub pipeline works: jobs, the repo registry, state and queues, data flow.

## Prerequisites

The `gh` CLI must be logged in as the instance's bot identity (`gh auth status`). Which `gh` binary, config dir, account and bot user the jobs use is `integrations.gh` in `jeeves-scripts.json` ([config.md](../../docs/config.md)).

## Operator rules

- **Use the bot identity** by default. Act as another identity only when the operator explicitly asks.
- **Never print a token.** When a tool needs one in the environment, take it from `gh auth token` inline at the point of use.
- **Authenticate through `gh`**, never by reading its files. A shell without the gateway's `GH_CONFIG_DIR` sees no login; export the same value.
- **Missing or broken login:** escalate to the operator; logins are provisioned with the instance, not with `gh auth login` on the host.
- **Bot token permissions** (minimum): classic PAT scopes `repo`, `workflow`, `read:org`; fine-grained: Contents, Pull requests, Issues and Workflows read/write, organization Members read.
