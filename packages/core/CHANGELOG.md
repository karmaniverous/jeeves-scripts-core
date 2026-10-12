# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-10-12

### 🚀 Features

- Add packages/core and packages/template workspaces (Decision 20)
- _(config)_ Config schema, silo resolver and config-check CLI ported from jeeves-scripts-template@322054c
- _(config)_ [**breaking**] Drop the deprecated forwardJGS alias; emailConfig.receipt is strict
- _(config)_ ImapSecretPath/resolveImapPassword default to paths().imapSecretsDir; port imap-secrets tests (found migrating JGS, Decision 30)
- Copy jeeves-scripts-template main@322054c into core wholesale (Decision 32)
- _(core)_ Export every built module as @karmaniverous/jeeves-scripts-core/<path> (instance deep imports during Decision 32)
- _(cli)_ Jeeves-scripts run <job-id> (Decision 16)
- _(dispatchers)_ Hoist JGS's task-file dispatcher into core, silo-aware (Decisions 23, 28)
- _(lib)_ Read other components' settings from their own config
- _(slack)_ Channel decisions in slack.channels, Slack facts from Slack
- _(skills)_ Core ships its own skills
- _(skills)_ Ship jeeves-standing-meetings and jeeves-dates
- _(people)_ People registry in config and its resolver
- _(people)_ Resolve listed people at every identity site
- _(people)_ Read-only people proposal from Slack
- _(slack)_ Relocate-archives moves Slack archives to the right silo
- _(email)_ Email apply-labels catches up classification labels
- _(email)_ People fields on downloaded Gmail message records
- _(jobs)_ DefineJob, the core job registry and core manifests; run resolves through the registry
- _(core)_ [**breaking**] Remove the daily digest; apply the approved admin renames (plan rows 36, 37)
- _(core)_ [**breaking**] Narrow the exports to the root API; conversion utilities (plan rows 39, 59)
- _(core)_ [**breaking**] People-propose and email-apply-labels runnables; descriptions; naming at registration (plan rows 54, 56, 57, 58, 61)
- _(core)_ [**breaking**] Remove the extensions config key (plan row 40)
- _(core)_ [**breaking**] The instance plugin, instance manifests and list (plan rows 38, 55, 58, 60)
- _(core)_ Thin convert runnables convert-pdf-to-md and convert-docx-to-md (plan row 59)
- _(core)_ Doctor (plan row 42)
- _(core)_ [**breaking**] The template as a usable instance repo (plan row 43)
- _(core)_ Init and the init-from-tarball CI job (plan row 44)
- _(core)_ Skills install | uninstall | status, JEEVES_SCRIPTS_DIR skill paths (plan row 45)
- _(core)_ The global hand-off (plan row 46)
- _(admin)_ Admin-report-token-metrics runnable; getTokenMetrics({ from, to })
- _(cli)_ Config check registers the plugin and validates manifests and deltas as list does
- _(core)_ --print-task and --dry-run for every task-file dispatcher (review docs D-2)
- _(core)_ Root-export the runnable argument parser and a Slack Web API client (Decision 59)

### 🐛 Bug Fixes

- Pin explicit outDir in packages/core/tsconfig.build.json
- Carry JGS's unreleased fixes into core (J8)
- _(jira)_ Sort-backlog reads integrations.jira.boardId (env JIRA_BOARD_ID fallback)
- _(cli)_ Validate jobs/*.json with Zod; fail on malformed entries (Decision 31)
- Name jeeves-scripts.json, not pipeline-config.json; ship the rate card seed from core
- _(package)_ Ship CHANGELOG.md, as the package README says
- _(slack)_ A DM belongs to the workspace of the account that reads it
- _(google-drive)_ Meta seeding uses the meta service's configured address
- _(cli)_ People propose --out guard ignores case
- _(email)_ Trim-jsonl keeps lines whose age is unknown
- _(x)_ Like/repost fail queue items the action did not perform
- _(convert)_ Quote YAML frontmatter values
- _(convert)_ Always destroy the pdf-parse parser
- _(email)_ Parse IMAP poll state with a Zod schema
- _(slack)_ Cap inlined file content at 256 KiB
- _(core)_ Tsx is a runtime dependency (plan row 38)
- _(cli)_ Main() resolves to 1 with one stderr line on run/list failures
- Messages, TSDoc and guides name jeeves-scripts.json keys, not constants.ts
- _(cli)_ Doctor shows prerequisite state; hand-off drops help, hints npm install; skills failures on stderr, uninstall leaves no empty objects
- _(jobs)_ Manifest JSON errors name the file; writtenFor is an exact semver; init errors name the value
- TaskFileDispatcher returns a run; admin crash labels; JIRA_BOARD_ID validated; stale TSDoc
- _(cli)_ No help verb; --help lists only the six verbs
- _(core)_ Runnables hand back their work; no process.exit; drain and session-refresh tests (review SOLID-1, SOLID-2, COV-1, COV-2, WT-1, OTH-3)
- _(core)_ --config wins over a cached config; inert deltas fail (review docs C-1 code side done earlier, email-apply-labels --config, R-6)
- _(core)_ The tsconfig preset excludes the instance's coverage/, dist/ and node_modules/ (Decision 58)
- _(core)_ Address Copilot review of PR #6 (typed X client, fake fetch headers, stale guides)

### 💼 Other

- _(config)_ Draft config and silo domain ported from jeeves-scripts-template@322054c (not yet gate-clean)
- Load rollup.config.ts natively instead of via --configPlugin (removes outputToFilesystem warning and .rollup.cache)
- Retire the Decision 32 legacy machinery
- Keep *.test-helper.ts out of the package
- _(openclaw-db)_ Name test-only fixtures *.fixtures.ts so they don't ship
- Revert "chore(release): release:pre publishes 1.0.0-rc.N"

This reverts commit 9031dd9d701a85aa874684fc38b6bac8deb190bf.

- Revert "chore(release): next core release is 0.1.0 (release bumps minor)"

This reverts commit ca9ea201a47fc7d661fd24f252eac011d61a27f9.

- _(core)_ Presets authored in TypeScript, shipped compiled (Decision 52)
- TypeDoc and release-it configs in TypeScript (Decision 52)
- _(core)_ Init names the package after its folder (Decision 53, Q33)
- _(core)_ JIRA_BOARD_ID wins over integrations.jira.boardId (Decision 53, Q25)
- _(core)_ A manifest's timeout is optional, as in the runner (Decision 54, Q37)
- _(core)_ Admin-check-qdrant-health schedule names its time zone (Decision 54, Q39)
- _(core)_ Manifest schedules take exactly the runner's forms (Decision 54, Q38)
- _(core)_ Config check validates the plugin's local block (Decision 54, Q40)
- _(core)_ Config check pins JEEVES_SCRIPTS_CONFIG before loading the plugin (Decision 54, Q40)
- _(core)_ Admin-sweep-orphaned-tmp sweeps jobs.<id>.extraDirs too (Decision 55, Q43)

### 🚜 Refactor

- Lib, slack, calendar, core, meta, linear, dispatchers and convert pass the strict gates (Decision 32)
- X, google-drive, jira and github pass the strict gates (Decision 32)
- Email, meetings and admin pass the strict gates; legacy list empty (Decision 32)
- _(lib)_ One OpenClaw config reader for gateway and Slack bot tokens
- _(lib)_ Split spawn-worker; test spawn retry, gatewayInvoke and the email cache
- _(linear)_ Validate the Linear config with Zod; test linearQuery and the paginators
- _(slack)_ Split poll.ts into single-purpose modules
- _(x)_ Split x-api into client, OAuth, timelines and actions
- _(meetings,admin)_ Split extract, doc-fetch and session-refresh
- _(meetings,email)_ Split the migrations, fathom-extract and imap/poll
- _(email)_ Decompose fetchThreadMetadata
- _(email)_ Move the gog account poll out of email/poll
- _(lib)_ One OpenClaw state-dir lookup
- _(slack)_ Channel workspace lives in the Slack cache
- [**breaking**] Core ships only behaviour every instance needs
- _(config)_ [**breaking**] Remove emailConfig.receipt
- _(core)_ Enforce the 300-line limit with max-lines; split the registry and four tests
- _(core)_ Settle the root export before v0.1.0 and pin it with a test
- _(core)_ GitHub, calendar and email jobs take their collaborators as parameters; no config read at import (review testability refactor, SOLID-7, DRY-9 partial)
- _(core)_ Meta, Slack, Google Drive, admin glue and worker-session take their collaborators; tests (review testability refactor, DRY-5, DRY-9)
- _(core)_ Meetings take their collaborators; per-file coverage gate; no help subcommand (review testability refactor, COV rows, D57, dead code)
- _(core)_ One retry helper, shared walks and fixtures (review DRY-4, DRY-5, DRY-6, DRY-7, DRY-8, DRY-10, DRY-11, WT-2, WT-F1, WT-F2)

### 📚 Documentation

- _(config)_ Export and document every config schema and resolved type (TypeDoc zero warnings)
- Google-drive spec and token-metrics runbook move here from the instances (guides/)
- Ship README, LICENSE, domain docs, guides and JSON Schema in the core package
- Sync core docs and usage text with jeeves-scripts.json and the launcher
- Authored docs live in guides/, TypeDoc output stays in docs/
- _(people)_ Document the people registry and people propose
- _(people)_ Example person is jane-doe
- Drop instance-specific names, ids and paths from core
- _(google-drive)_ Trim instance spike and verification notes from the design record
- _(admin)_ Pending-models add/prune race is self-healing, not lossless
- _(jobs)_ Guides/jobs.md (registry, defineJob, manifests, deltas); run resolution and job ids across the guides
- Guides and READMEs match the design (plan row 48)
- _(linear)_ The Linear config default is {credentialsDir}/linear.json
- _(core)_ TSDoc and the email guide name the runnables, not the removed verbs
- _(guides)_ Config check registration, doctor states, skills uninstall, override labels, hand-off before npm install
- _(core)_ Fix every core docs-review row (review docs C-1..R-11 core rows, D-1, J-1, J-2, F-1, OTH-4, OTH-6)
- Render the guides as one TypeDoc Guides section

### 🎨 Styling

- _(jira)_ Sort imports

### 🧪 Testing

- _(admin)_ 30 s timeout for the SQLite-fixture collector tests
- Example Slack account is work, not vc
- Neutral base root in path and config tests
- Instance-agnostic guard with one documented deny list; remove instance names, paths and ids from core
- _(admin)_ SQLite fixtures skip per-statement fsync; 30 s timeout for the collector-graph tests
- _(core)_ Replace weak tests, drop test-only exports (review WT-4, WT-5, WT-6, WT-7, WT-8, WT-10, OTH-2)
- _(core)_ Cover the Windows branch of isSamePath on every platform (CI coverage gate on Ubuntu)
- _(core)_ Neutral placeholders for instance-looking values (AGENTS.md sweep)
- Create directory links as junctions so tests pass without symlink privilege

### ⚙️ Miscellaneous Tasks

- _(core)_ Replace the instance-agnostic deny list with authoring instructions
- _(core)_ Cheap spec/code mismatches from audit 2 (help text, PR template, TSDoc, engines)
- Release @karmaniverous/jeeves-scripts-core v0.1.0

### ◀️ Revert

- _(slack)_ Take relocate-archives out of core
