---
name: jeeves-github
description: GitHub integration - repo sync, issue sync, notifications, and collaborator management. Use when working with the GitHub pipeline, debugging GitHub sync, or using the gh CLI as the instance's bot.
metadata: { 'openclaw': { 'requires': { 'env': ['JEEVES_SCRIPTS_DIR'] } } }
---

# GitHub

Read [github.md]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/github.md) for how the GitHub pipeline works: jobs, the repo registry, state and queues, data flow.

## Prerequisites

The `gh` CLI must hold the instance's bot login and its account login (`gh auth status`; see Token requirements below). The jobs switch between them and leave `gh` on the account, so run `gh auth switch -u <botUser>` before acting as the bot. Which `gh` binary, config dir, account and bot user the jobs use is `integrations.gh` in `jeeves-scripts.json` ([config.md]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/config.md)).

## Operator rules

- **Use the bot identity** by default: switch to it first (`gh auth switch -u <botUser>`), since the jobs leave the account login active. Act as another identity only when the operator explicitly asks.
- **Never print a token.** When a tool needs one in the environment, take it from `gh auth token --user <botUser>` inline at the point of use.
- **Authenticate through `gh`**, never by reading its files. A shell without the gateway's `GH_CONFIG_DIR` sees no login; export the same value.
- **Missing or broken login:** escalate to the operator. The login lives in `GH_CONFIG_DIR` (provisioned with the instance); the operator repairs it there (`gh auth login` with `GH_CONFIG_DIR` set), never in the default `gh` profile.

## Token requirements

The jobs reach GitHub through `gh`, as two logins in `GH_CONFIG_DIR` (`integrations.gh`), switching between them and checking each switch:

- `integrations.gh.account`: the account whose repos the instance syncs. `github-build-registry`, `github-sync-repos` and `github-sync-issues` run as it; `github-poll-collabs` lists its repos and `github-drain-collabs` adds the bot to them; `github-watch` reads its notifications.
- `integrations.gh.botUser`: the bot. `github-watch` reads its notifications; `github-poll-collabs` and `github-drain-collabs` list and accept its repository invitations.

**Both need a classic PAT.** Fine-grained tokens can't do what the jobs need: GitHub offers neither the notifications API (`github-watch`, both logins) nor accepting a repository invitation (`PATCH /user/repository_invitations/{id}`, the bot) to fine-grained tokens.

- **Account:** scopes `repo` (private repos and their clones, issue search, notifications, adding collaborators, which also needs admin rights on the repo) and `read:org` (`github-build-registry` lists the repos of its orgs).
- **Bot:** scope `repo` (invitations, notifications, and the repos it works in).
- **Add `workflow`** to a login that pushes changes to `.github/workflows/` (e.g. PRs the bot opens). No job does.
- **Creating repos** (e.g. an instance's scripts remote) also needs repo-creation rights in the org.
- A tool that wants `GH_TOKEN` takes it inline from `gh auth token --user <botUser>`: plain `gh auth token` gives whichever login the last job switched to. Never print or log it.
