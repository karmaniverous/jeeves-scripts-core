## What and why

<!-- What this changes and why. -->

## Instance-agnostic confirmation (required)

See [AGENTS.md](../AGENTS.md#instance-agnostic-additions-mandatory).

- [ ] Every addition in this PR is useful to any Jeeves instance, not just one.
- [ ] Nothing in this PR names an instance, client, tenant, person or host, or contains a real id or an instance path.
- [ ] Examples use neutral placeholders (Jane Doe, `example.com`, `acme`, `/base`, `D:/`, ids like `C000EXAMPLE1`).
- [ ] Every value that differs between instances comes from `jeeves-scripts.json` or the owning component's config, never hard-coded.

## Gates

- [ ] build, lint, typecheck, test, knip and docs pass from the repo root.
