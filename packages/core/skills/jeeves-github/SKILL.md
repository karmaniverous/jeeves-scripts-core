---
name: jeeves-github
description: GitHub integration - repo sync, issue sync, notifications, and collaborator management. Use when working with the GitHub pipeline, debugging GitHub sync, or using the gh CLI as the instance's bot.
metadata: { "openclaw": { "requires": { "env": ["JEEVES_SCRIPTS_DIR"] } } }
---

# GitHub

Read [github.md]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/github.md) for how the GitHub pipeline works: jobs, the repo registry, state and queues, data flow.

## Prerequisites

The `gh` CLI must be logged in as the instance's bot identity (`gh auth status`). Which `gh` binary, config dir, account and bot user the jobs use is `integrations.gh` in `jeeves-scripts.json` ([config.md]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/config.md)).

## Operator rules

- **Use the bot identity** by default. Act as another identity only when the operator explicitly asks.
- **Never print a token.** When a tool needs one in the environment, take it from `gh auth token` inline at the point of use.
- **Authenticate through `gh`**, never by reading its files. A shell without the gateway's `GH_CONFIG_DIR` sees no login; export the same value.
- **Missing or broken login:** escalate to the operator. The login lives in `GH_CONFIG_DIR` (provisioned with the instance); the operator repairs it there (`gh auth login` with `GH_CONFIG_DIR` set), never in the default `gh` profile.

## Token requirements

The jobs reach GitHub through `gh`, as two logins in `GH_CONFIG_DIR` (`integrations.gh`): the bot, and the owner account whose repos the collaborator jobs share with it.

- **Bot: a classic PAT** with scopes `repo` and `read:org`. A fine-grained PAT can't do the bot's job: GitHub doesn't offer the notifications API to fine-grained tokens (`github-watch`), nor accepting a repository invitation (`PATCH /user/repository_invitations/{id}`, `github-drain-collabs`). `repo` covers private repos and their clones (`github-sync-repos`), issue search (`github-sync-issues`), the invitations and notifications; `read:org` lets `github-build-registry` list the repos of orgs the bot belongs to.
- **Add `workflow`** when the bot pushes changes to `.github/workflows/` (e.g. PRs it opens). No job does.
- **Owner account:** `github-poll-collabs` lists its own repos and `github-drain-collabs` adds the bot as a collaborator (`PUT /repos/{owner}/{repo}/collaborators/{bot}`): classic scope `repo`, or a fine-grained PAT with repository permission Administration read/write on those repos (Metadata read is added automatically).
- **Creating repos** (e.g. an instance's scripts remote) also needs repo-creation rights in the org.
- Tools that want `GH_TOKEN` get it inline from `gh auth token`; never print or log it.
