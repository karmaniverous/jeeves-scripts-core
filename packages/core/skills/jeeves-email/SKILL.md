---
name: jeeves-email
description: Email pipeline - Gmail (via gog CLI) and IMAP polling, download, triage, classification, and label management. Use when working with the email pipeline, debugging email jobs, setting up gog for Gmail, or understanding email curation signals.
---

# Email Pipeline

Read [email.md](../../docs/email.md) for how the pipeline works: transports, jobs, account configuration, classification and labels, state and queues, output layout.

## Operator rules

- **Per-instance settings are the operator's call.** Which accounts to poll, how far back to ingest, labels and forwarding destinations live in this instance's `jeeves-scripts.json` (`pipeline` block, [config.md](../../docs/config.md#the-pipeline-block)). Ask; don't guess or copy another instance's values.
- **Never commit secrets.** IMAP passwords are secret references resolved from the credentials folder, never values in `jeeves-scripts.json`. Ask the operator how to provision one before configuring an account that needs it.
- **Report-only first.** A new instance starts with report-only on, so no Gmail labels change until the operator turns it off.
- Run `config check` after editing accounts (see `jeeves-scripts`).

## gog

- Gmail goes through the `gog` CLI. When gog is installed, its own skills (`gog-gmail`, `gog-auth`) cover command details.
- Auth modes (`gog auth list` shows them): `oauth` (personal accounts, interactive consent), `service_account` (Workspace, domain-wide delegation, one registration per mailbox), or both.
- If `gog` works from your shell but email jobs report auth errors, the runner's environment lacks gog's home or keyring settings: report it to the operator rather than copying keys around.
