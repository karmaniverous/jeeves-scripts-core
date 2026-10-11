---
name: jeeves-x
description: X/Twitter integration - polling posts/mentions/feed, posting, liking, reposting. Use when working with the X pipeline or social media automation.
metadata: { "openclaw": { "requires": { "env": ["JEEVES_SCRIPTS_DIR"] } } }
---

# X (Twitter)

Read [x.md]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/x.md) for how the X pipeline works: jobs, account configuration, the OAuth credential files, queues and data flow.

## Operator rules

- **Credentials are secrets.** The OAuth files live where x.md says, in the credentials area; never in the repo, config or a chat message.
- **Accounts are config.** Which handles are polled, and the silo each writes to, are `integrations.x.accounts` in `jeeves-scripts.json` ([config.md]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/config.md)). Ask the operator before adding one.
- **Posting, liking and reposting act publicly** as the account. Only do it on an explicit request, and confirm the exact text first.
