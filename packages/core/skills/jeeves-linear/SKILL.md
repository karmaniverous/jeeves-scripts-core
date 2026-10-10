---
name: jeeves-linear
description: Linear integration - webhook drain, polling sync, backfill, and entity conventions. Use when working with the Linear pipeline or archive, or answering questions from archived Linear issues.
---

# Linear

Read [linear.md](../../docs/linear.md) for how the Linear pipeline works: webhook drain, polling sync, backfill, archive layout and reverse-diff entity format, API client, watcher configuration.

## Prerequisites

- The API key is a file in the credentials folder whose path is `integrations.linear.configPath` in `jeeves-scripts.json` ([config.md](../../docs/config.md)); never a config value or a repo file.
- Webhooks reach the drain through the jeeves-server Event Gateway ([Event Gateway Config](../../docs/linear.md#event-gateway-config)); ask the operator to change the route rather than editing the live server config.

## Operator rules

- **Answer from the archive:** each entity file holds the current snapshot and its change history; prefer it (or watcher search over it) to calling Linear.
- **Linear does not replay missed webhooks;** the polling sync jobs fill gaps, so a gap usually means a sync job is failing. Check its last runs before backfilling.
- **Backfills are dry runs by default;** run one live only when the operator asks.
