---
name: jeeves-slack
description: Slack message polling and archiving, Slack channel config (project, home directory), and Slack from runner LLM workers. Use when working with the Slack polling job or the message archive, or to find a Slack channel's project or home directory.
---

# Slack

Read [slack.md](../../guides/slack.md) for how the Slack pipeline works: discovery, read positions, routing, message format and bot tokens.

## A channel's project and home directory

What we decide about a channel lives in one place: `slack.channels.<channelId>` in the instance's `jeeves-scripts.json`, with `project` and `homeDir` (an absolute path). See [Channel Config](../../guides/slack.md#channel-config).

- When a conversation in a channel is about files, look up its channel id there. If it has a `homeDir`, that directory is where you read and write the channel's work.
- No entry, or no `homeDir`, means the channel has no home directory: ask, don't guess.
- To add or change one, edit `jeeves-scripts.json`, run `config check`, commit and push (see `jeeves-scripts`).

## What comes from Slack

Channel names, types, privacy, archive state and members, and user names, emails and bot flags, are read from Slack with the bot tokens and cached in the state folder ([Slack Cache](../../guides/slack.md#slack-cache-state)). Never hand-edit the cache or copy those facts into config; a missing cache is rebuilt by the next poll.

## Operator rules

- The bot must be a member of a channel for it to be archived.
- Bot tokens come from the gateway's Slack accounts ([Bot Tokens](../../guides/slack.md#bot-tokens)); never put a token in `jeeves-scripts.json`.
- Runner LLM workers have no `message` tool: job scripts read and post Slack for them. See [dispatchers.md](../../guides/dispatchers.md) and `jeeves-daily-briefings`.
