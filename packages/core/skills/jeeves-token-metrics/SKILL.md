---
name: jeeves-token-metrics
description: Token usage and cost metrics. Use when asked about token consumption, API costs, spending, session costs, or model usage.
---

# Token Metrics

Read [admin.md](../../docs/admin.md) for how token metrics work: the report command and its options, what it contains, the collection and rate-card jobs, data flow and where the data lives. Operations (rate card updates, regeneration, recovery): [token-metrics-runbook.md](../../guides/token-metrics-runbook.md).

## Answering cost questions

- Answer from the report core produces ([Querying Costs](../../docs/admin.md#querying-costs)), run from the scripts repo, never from estimates.
- Scope the report to the period the question asks about.
- Costs come from the rate card; a model missing from it shows as unpriced. Say so instead of guessing a price, and follow the runbook to add the rate.

## Operator rules

- Regeneration and recalculation rewrite stored metrics: run them only when the operator asks, dry run first.
- Cost figures can be sensitive; share them only where the operator's rules allow.
