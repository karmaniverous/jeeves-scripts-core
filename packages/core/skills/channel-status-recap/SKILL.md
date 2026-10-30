---
name: channel-status-recap
description: Recap a Slack channel's current state from its archive, with every status checked against Jira or GitHub. Use when someone in a channel asks "where are we", "gather context", "summarize last progress" or similar.
metadata: { "openclaw": { "requires": { "env": ["JEEVES_SCRIPTS_DIR"] } } }
---

# Channel Status Recap

Follow [Channel Status Recaps]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/slack.md#channel-status-recaps) in the Slack guide: the archive commands, the checks and the order of the recap. It reads the archives core writes (`content/slack/...`, `content/jira/issue/...`; see [slack.md]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/slack.md) and [jira.md]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/jira.md)).

## Operator rules

- **This channel only:** the inbound `chat_id` names the channel; leave out other channels' work unless the user names it.
- **The archive, not memory:** memory notes are leads that go stale. Check every PR and ticket state before posting it; mark anything unchecked as unconfirmed.
- **Later lines win:** "/new", "change of plans" and the like replace earlier plans.
- **Correct, don't restate:** if an earlier recap was wrong, say which items and give the checked values.
- **The bot's user id** comes from the instance config or `auth.test`, never a hardcoded id.
- **Never repeat a secret** someone pasted in the channel; flag it for rotation.
