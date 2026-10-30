---
name: jeeves-token-metrics
description: Token usage and cost metrics. Use when asked about token consumption, API costs, spending, session costs, or model usage.
metadata: { 'openclaw': { 'requires': { 'env': ['JEEVES_SCRIPTS_DIR'] } } }
---

# Token Metrics

Read [admin.md]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/admin.md) for how token metrics work: the report command and its options, what it contains, the collection and rate-card jobs, data flow and where the data lives. Operations (rate card updates, regeneration, recovery): [token-metrics-runbook.md]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/token-metrics-runbook.md).

## Answering cost questions

- Answer from the report core produces, never from estimates: `node "$JEEVES_SCRIPTS_DIR/bin/jeeves-scripts.js" run admin-report-token-metrics --from <date> --to <date>` ([Querying Costs]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/admin.md#querying-costs)).
- Scope the report to the period the question asks about.
- Costs come from the rate card. The collector writes no buckets for a model missing from it: it records the model as pending and triggers a rate refresh, so those hours appear once the rate lands. Say so instead of guessing a price, and follow the runbook to add the rate if the refresh can't find it.

## Operator rules

- Regeneration rewrites stored metrics: run them only when the operator asks, dry run first.
- Cost figures can be sensitive; share them only where the operator's rules allow.
