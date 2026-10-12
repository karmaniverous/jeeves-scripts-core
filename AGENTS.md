# AGENTS.md: jeeves-scripts-core

Read this before changing anything in this repository.

## Instance-agnostic additions (mandatory)

This package is public and shared by every Jeeves instance. Every addition must be generic: useful to any instance, and free of anything that identifies a particular one.

Before you add or change code, docs, skills, tests, fixtures or job manifests here, confirm for each addition that:

1. **Every instance would want it.** If only one instance needs it, it belongs in that instance's own repo (a local job, plugin or script), not here.
2. **It names no instance.** No instance, client, tenant, company, person or host names. No real Slack, Notion, Google Drive or other ids. No instance drive letters or paths. No one-off migration for a single host.
3. **Examples are neutral.** Use placeholders such as Jane Doe, `example.com`, `acme`, `/base`, `D:/` and ids that say what they are (`C000EXAMPLE1`).
4. **Instance values come from config.** Anything that differs between instances is read from `jeeves-scripts.json` or from the owning component's config, never hard-coded.

If you can't confirm all four, stop and ask the owner before writing it.

State the confirmation in the PR description (the PR template has the checkbox). A PR without it is not ready for review.

## Other rules

- Never disable lint or type checks (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`). Fix the code.
- Run all gates from the repo root before every push: build, lint, typecheck, test, knip, docs.
- Releases use `release-it` as configured. Don't change the release machinery without the owner's approval.
