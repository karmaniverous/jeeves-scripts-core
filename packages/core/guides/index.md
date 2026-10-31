---
title: Guides
children:
  - ./cli.md
  - ./config.md
  - ./runnables.md
  - ./lib.md
  - ./admin.md
  - ./calendar.md
  - ./convert.md
  - ./dispatchers.md
  - ./email.md
  - ./github.md
  - ./google-drive.md
  - ./jira.md
  - ./library.md
  - ./linear.md
  - ./meetings.md
  - ./meta.md
  - ./punch-list.md
  - ./slack.md
  - ./transcripts.md
  - ./x.md
  - ./google-drive-spec.md
  - ./token-metrics-runbook.md
  - ../CHANGELOG.md
---

# Guides

Hand-written references for `@karmaniverous/jeeves-scripts-core`: the framework (CLI, configuration, runnables, shared library), one guide per domain, and design records and runbooks. The API reference covers every export; these guides cover how the pieces fit together and how to operate them.

## Framework

- [CLI](./cli.md): The `jeeves-scripts` CLI and the instance launcher
- [Configuration](./config.md): the instance config and its pointer: schema, resolution, editing, moving, getters, silos
- [Runnables](./runnables.md): The runnable registry: ids, `defineRunnable`, manifests, instance deltas, the instance plugin
- [Shared Library](./lib.md): Shared infrastructure: constants, gateway, workers, gh, gog, entity store

## Domains

- [Admin](./admin.md): Token metrics, rate card, session refresh, housekeeping (`.tmp` sweep, Qdrant health)
- [Calendar](./calendar.md): Google Calendar polling
- [Convert](./convert.md): DOCX and PDF to Markdown
- [Dispatchers](./dispatchers.md): Task-file dispatchers and job-side Slack I/O
- [Email](./email.md): Gmail (gog) and IMAP polling, download, backfills
- [GitHub](./github.md): Repo and issue sync, notifications, collaborators, cross-repo file and ruleset sync
- [Google Drive](./google-drive.md): Drive sync into the content tree
- [Jira](./jira.md): Jira webhook drain, backfill, backlog sort
- [Library](./library.md): Public repo subdirectories mirrored into the content tree as reference libraries
- [Linear](./linear.md): Linear webhook drain, sync, backfill
- [Meetings](./meetings.md): Meeting extraction (Meet, Fathom, Notion)
- [Meta](./meta.md): Entity lifecycle maintenance
- [Punch List](./punch-list.md): The instance's daily punch list of platform work: status from GitHub, harvesting from the archive
- [Slack](./slack.md): Slack polling and archiving
- [Transcripts](./transcripts.md): YouTube transcripts fetched to disk through TranscriptAPI
- [X](./x.md): X/Twitter polling, posting, engagement

## Design records and runbooks

- [Google Drive Sync Design](./google-drive-spec.md): Design record for the Drive sync
- [Token Metrics Runbook](./token-metrics-runbook.md): Operating and repairing token metrics collection

## Releases

- [Changelog](../CHANGELOG.md)
