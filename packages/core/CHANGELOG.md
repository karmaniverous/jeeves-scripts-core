# Changelog

All notable changes to this project will be documented in this file.

## [0.3.4] - 2026-11-06

### 🐛 Bug Fixes

- *(admin)* Session refresh stops at an in-place reset
## [0.3.3] - 2026-11-06

### 🚀 Features

- Export the helpers instances copy; add timeoutMs to gh()

### ⚙️ Miscellaneous Tasks

- Pin nvmrc to the engines floor; build core before tests
- Release @karmaniverous/jeeves-scripts-core v0.3.3
## [0.3.1] - 2026-11-05

### 🐛 Bug Fixes

- *(config)* Warn, not fail, when config check can't read the gateway Slack accounts

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-scripts-core v0.3.1
## [0.3.0] - 2026-11-04

### 🚀 Features

- *(slack)* Export normalizeSlackTarget from the package root
- *(runnables)* On_failure in manifests and job deltas
- *(token-metrics)* Read OpenClaw agent DB schema 24
- *(slack)* Slack-backfill-history re-reads a channel without moving the poll position
- *(config)* Jeeves-scripts.json may point at the config directory (#57)
- *(cli)* Run and doctor register the instance root instead of forcing JEEVES_SCRIPTS_CONFIG (#57)
- *(config)* Config check and doctor say where the config came from (#57)
- *(config)* Pure helpers for config set/unset (#57)
- *(cli)* Config set and config unset (#57)
- *(cli)* Init --config-dir writes the config outside the repo and points at it (#57)
- *(config)* Github-sync-files delta fields (files, owners, account, ruleset)
- *(github)* Github-sync-files keeps files and a ruleset in sync across owners' repos
- *(config)* Library block for library-sync-mirrors (mirrors, unique ids, non-overlapping dests, site-link template)
- *(library)* Library-sync-mirrors mirrors public repo subdirectories into the content tree (checksum rsync, .meta preserved)
- *(lib)* One TASK-template resolver for core templates (Decision 75)
- *(dispatchers)* Daily-briefing templates, values and summary shape (#33)
- *(config)* PunchList and transcripts blocks (Decision 76)
- *(punch-list)* Hoist the punch list domain (#45)
- *(transcripts)* Transcripts-fetch-video and the jeeves-transcripts skill (#54)
- Register punch-list and transcripts, root exports and docs
- *(transcripts)* Cache the API response on a dry run so --live spends no second credit
- *(lib)* Dated-report, run-dirs and server-link report helpers
- *(slack)* Slack-refresh-channel-meta (#49)
- Export the report-link helpers from the package root
- *(email)* Export respond DKIM check and address parser from the package root
- *(lib)* Carry the gateway's error code and details in GatewayRpcError (#73)
- *(admin)* LastTurnUsage on the schema-23/24 agent-DB reader (#73)
- *(admin)* Token metrics names an agent's main session main (#73)
- *(config)* ContextThreshold, idleMinutes and excludedKeys on the admin-refresh-sessions delta (#73)
- *(admin)* [**breaking**] Rebuild admin-refresh-sessions on the gateway and the agent DB (#73)
- *(admin)* Re-check busy with sessions.list activeOnly before each live reset (#73)
- *(admin)* A session is busy while a session it spawned has an active run (#73)
- *(cli)* Doctor fails when Node is below the 24.22.2 floor (#75)
- *(email)* Email-respond allowedSenders accepts *@domain and *@*.domain patterns (#53)

### 🐛 Bug Fixes

- *(github)* Github-watch creates watch/ before appending its log
- *(lib)* Read openclaw.json as JSON5; fail on unreadable or invalid configs
- *(github)* Verify the acting gh account after every account switch
- *(github)* Sync-repos follows a changed default branch and fails on sync errors
- *(slack)* Never send oldest 0; a fake Slack that orders history like the real one
- *(github)* Drain-collabs hands back untried items on an account mismatch; test the bot-switch checks
- *(lib)* Accept OpenClaw SecretRefs in openclaw.json token fields
- *(github)* Sync-repos reclone puts the old mirror back if the swap fails
- *(slack)* Validate --before and saved backfill progress; test restarts and the poll position
- *(lib)* Keep secretRefSchema internal
- *(github)* Drain-collabs dequeues one item at a time
- *(github)* Sync-repos guards every reclone step and clears leftover copies each sync
- *(lib)* Resolve OpenClaw env references in token fields; any object is a SecretRef
- Skill says to switch to the bot first; template pins basic-ftp; helper doc comment back in place
- *(lib)* Env references also resolve from the .env beside openclaw.json and env.vars; name unresolved ones
- *(github)* Drain-collabs queues the mismatched item again
- Skill uses a per-command GH_TOKEN for the bot; reclone's opening cleanup only warns
- *(config)* Config paths see own keys only, refuse prototype keys; distinct backups within a second
- *(cli)* Config set/unset keep every backup, restore the env, retry the rename and refuse a concurrent change
- *(config)* The repo's jeeves-scripts.json is legacy however it is named; config check keeps the source when the plugin fails
- *(cli)* Init refers to the schema across drives, keeps the config dir outside the repo, and writes no sample over a legacy config
- *(template)* The sample test writes its own config, so a new instance's npm test passes
- People-propose never writes the config file; messages say the instance config
- *(config)* A pointer's config dir must be absolute on this platform
- The watcher's map helpers pick up config edits; docs on value quoting
- *(config)* The launcher's instance root reaches the plugin's copy of core
- *(library)* Delete newly excluded files, drop escaping symlinks, refuse a source outside the clone, ignore a stale incoming on a dry run, match site links case-insensitively, refuse .meta in any case
- *(github)* Refuse sources outside the instance root, treat only a 404 as missing, compare by git blob SHA, record last-run after the switch back
- *(library)* Fail a configured run when git or rsync is missing; doctor reports it through a new doctorCheck
- *(library)* Refuse to take over an existing dest the mirror didn't write unless adopt: true; record each live publish
- *(library)* Name the publish record file when it can't be read or isn't valid
- *(punch-list)* Expand {npmGlobal} by the target platform's path rules
- *(punch-list)* Ship both manifests as dry runs; the enabling delta adds --live
- *(punch-list)* Accept {home}/{npmGlobal} input roots and read npm's real global prefix
- *(punch-list)* A harvest dry run leaves no inbox or report behind
- *(punch-list)* Slack.channel takes a conversation id only
- *(punch-list)* No link for a file on another Windows drive
- *(task-template)* Confine template and include names to task-templates/
- *(briefings)* Reference heading and block, run mode, own-directory checks
- *(slack)* Quote proposed config set commands for POSIX shells and PowerShell, run from the instance repo
- *(slack)* A history read cut at its page cap still advances the sweep
- *(slack)* A preview fails on an unusable worker result, opens no DM and deletes no run directory
- *(slack)* Check channel-meta's Slack accounts against the gateway; skip with no loadable config
- *(lib)* Time out the jeeves-server link lookup
- *(admin)* A live reset line no longer says ownership unknown once the active list settled it (#73)
- *(admin)* Session refresh skips OpenClaw's all-zero delivery-mirror copies when reading the last turn (#73)
- *(admin)* The reset notice goes only to Slack-keyed sessions whose origin is Slack (#73)
- *(email)* Email-poll polls every account when one fails, then fails the run naming each (#66)
- *(email)* [**breaking**] Subdomain senders need DKIM from exactly their own domain (#53)
- *(email)* AllowedSenders takes only exact addresses and *@domain (#53)
- *(email)* Email-poll keeps every failure in the run error (#66)
- *(cli)* A prerelease of the Node floor does not meet it (#75)

### 💼 Other

- Installed git-cliff
- PR J: Skill Workshop review job (#70) (#72)

* refactor(config): share the report-directory, Slack-account and readable-config rules

Move defaultReportDir (now taking the block's name for its message), isChannelTarget and the gateway Slack account check to config/report-target, and channel-meta's readableConfig to config/readable-config, so the skillReview block (#70) uses the same rules. No behaviour change.

* feat(lib): let gatewayRpc set the CLI's wait for the gateway's answer

An optional options.waitMs becomes the openclaw CLI's --timeout (unset: the CLI's 10 s default), so a slow method such as skills.status can wait longer without a shell.

* feat(config): add the skillReview block

A typed, optional top-level block for the Skill Workshop review (#70): reportChannel, reportAccount (checked against the gateway's Slack accounts by config check), timezone, serverKey, outputDir (default the report channel's homeDir, checked on the whole config through the shared defaultReportDir) and budgetAlertPercent (1-100, default 90).

* feat(admin): hoist the Skill Workshop review as admin-review-skill-proposals

Daily, report-only review of pending Skill Workshop proposals against the installed skill inventory, with a dated report, a numbered Slack summary and the skills catalog budget (OpenClaw 2026.9.6 eb377ac port) plus a quiet-day alert. Applies nothing. Opt-in through the skillReview block; manifest shipped disabled and dry without --live. The 160 description limit is counted in UTF-8 bytes, as OpenClaw enforces it.

Closes #70

* test(admin): cover the skill review's unreadable-file, missing-marker, live-line and empty-block branches

* docs(admin): name the skill review worker's report file as the code writes it (report.md)

* test(admin): kill the skill review's surviving mutants (gateway artifacts, 4-char cap, one long description, live --print-task, kept runs, posting account, punctuation, blank lines)

* chore(deps): update vitest, @vitest/coverage-v8, officeparser, rollup and basic-ftp (minor and patch)

* refactor(lib): move escapeSlack/decodeSlack to lib/slack-text, shared by slack/channel-meta and admin/skill-review

* fix(admin): reject dot-only Workshop proposal ids in the skill review gather

* test(admin): a --live skill review run dispatches the worker as live

* fix(admin): count the skill review's 160 description limit in chars, a Jeeves catalog-size convention, not an OpenClaw limit

* feat(admin): name the proposal id on each line of the skill review post, so a reply's numbers map to ids from the post

* docs(admin): state precisely when the catalog port's skill paths differ from OpenClaw's, including the /data container layout

* test(admin): kill the review-fix mutants (chars in the snapshot and TASK, revised/added ids in the post's clash set); postId tests in their own file ([#72](https://github.com/karmaniverous/jeeves-scripts-core/pull/72))
- [**breaking**] Require Node >=24.22.2 (#75)

### 🚜 Refactor

- *(runnables)* Rename src/jobs to src/runnables and defineJob to defineRunnable
- *(lib)* Use retry helpers from @karmaniverous/jeeves
- Split core source files over 300 lines (#17)
- *(email)* Use getErrorMessage from @karmaniverous/jeeves in the download
- *(runnables)* Say runnable, not job, in defineRunnable's messages and docs
- *(slack)* Move the channel reader into slack/lib/read-channel
- *(slack)* Backfill-history skips like slack-poll; drop an unreachable branch
- *(lib)* One isEnoent for the three ENOENT checks
- Share the acting-login read, move tally counting into the tally module, split library staging out of mirrorTree
- *(library)* Pass the optional mirror deps straight through; build the failure message from the failures
- Read a failed gh call's output in one place; compute each failure message once; runMirrors skips through libraryPrerequisite
- *(library)* Drop the platform and deviceOf seams no caller or test sets
- *(punch-list)* State files through core's JSON file helpers
- *(punch-list)* One manifest reader for the runnable tests
- Drop two checks the mutation run proved redundant
- *(task-template)* Reuse lib/path-within for the inside-root check
- Take the runnable argument parser from @karmaniverous/jeeves (jeeves#151)
- *(slack)* Narrow channel-meta settings by returning the problem
- *(config)* Write the channel-meta report directory rule once; keep the slack schemas pick/omit-safe
- *(admin)* One skip constructor for session refresh's run flow (#73)
- *(admin)* Session refresh closes the agent DBs before the live resets; doctor checks the listed agents (#73)
- *(email)* Put each poll helper's TSDoc on its own helper (#66)

### 📚 Documentation

- *(email)* Add the adding-a-mailbox procedure to the email guide and skill
- *(email)* Address review on adding a mailbox
- *(runnables)* Runnable vs job wording across guides and skills
- *(skills)* Core package rules, Jira links and ticket edits, channel-status-recap
- Clear the TypeDoc warnings
- *(runnables)* Omitting on_failure leaves an existing runner job's target
- *(runnables)* Upgrading to 0.3.0 renames defineJob in the instance
- Fix module paths the src/runnables rename left in TSDoc
- Jeeves retry helpers reject attempts below 1
- *(runnables)* Sync-jobs updates existing runner jobs from the effective manifest
- *(slack)* Oldest 0, re-reading history and the affected-channel check
- *(skills)* Jeeves-github token requirements, checked against the jobs' calls
- List slack-backfill-history; token metrics reads schema 23 or 24
- *(skills)* Jeeves-github token requirements by login, checked against each job's switch
- The config lives outside the repo; config set/unset; moving runbook (#57)
- *(github)* Cross-repo file and ruleset sync guide, delta fields and token scopes
- *(library)* Library mirrors guide, config block, runnable id and prerequisites (git, rsync)
- Library mirror symlink, exclude, dry-run and site-link rules; github-sync-files source, read, compare and user-owner rules; workflow scope for workflow targets
- Github guide covers file and ruleset sync in the indexes, an unreadable acting login and a non-empty target; the publish record's read error; doctorCheck link
- *(skills)* Dispatcher dry-run flag and the CLI form in the new skills
- *(transcripts)* The cache holds the re-serialised response; dry-run credit cost
- *(slack)* Channel meta guide, config and runnables references, jeeves-slack skill
- Release audit of guides, README and template against the code
- *(slack)* Channel-meta's account check and no-config skip in the guides
- Say the instance config, not jeeves-scripts.json, wherever the config is meant
- *(slack)* Run the channel-meta preview with the repo launcher
- *(lib)* No TSDoc links to names off the root export
- *(skills)* Trim shipped skill descriptions to 160 chars or less
- *(admin)* Session refresh on the gateway and the agent DB (#73)
- *(admin)* [**breaking**] Admin-refresh-sessions release notes: re-enable with enabled true and --live; main sessions, DMs, child-run busy, Slack-keyed notice (#73)
- *(email)* AllowedSenders, subdomain DKIM rule, poll failures, retry departure (#53, #66)

### 🎨 Styling

- One @karmaniverous/jeeves import per file after the retry swap

### 🧪 Testing

- *(email)* Drop headerLines from attachment fixtures
- *(config)* List onFailureSchema in the root export
- *(meetings)* Type the Notion request mock in notion-blocks tests
- *(meetings)* ResolveChromePath tests move to chrome-path.test.ts
- *(config)* Validate on_failure in jobs deltas
- *(slack)* One Slack-ordered history fake in poll.test-helper
- *(skills)* Read skill metadata as JSON5, like OpenClaw; format the skills with Prettier
- *(github)* An invalid github-sync-files delta fails config check and the run (Decision 76)
- *(github)* Share the sync-files world hooks and gh interception in the test helper
- *(library)* Share the mirrorTree fixture and the runnable loader; prove config check with the runnable once; assert the library JSON Schema shape
- Unit-test the staging step; cover stdout-only 404s, output-less read failures and empty listings; assert exact values where tests only checked presence
- Kill the surviving mutants: payload temp dirs removed, sent/local rsync writes counted, a name shared in one top-level dir left alone, stale incoming cleared, temp dir only on live publishes, clone shallow
- *(punch-list)* Exact assertions instead of bare throws and counts
- *(punch-list)* Kill the surviving mutants
- Neutral fixture names in the PR's tests and docs
- *(punch-list)* Split the harvest run tests (shared sandbox, dry-run file)
- *(punch-list)* Cover the live npm prefix read; split the expansion tests
- *(slack)* Batch order takes a channel's oldest wanted field wherever it is listed
- *(slack)* Close channel-meta mutation survivors; generic names in ported fixtures
- *(slack)* Generic ids in the last two ported fixtures
- *(email)* Restore the respond fixture's exact bytes
- *(slack)* Run the channel-meta config test with the runnable's own context type
- *(library)* Give the prototype-parity test room on slow Windows hosts
- *(admin)* Kill session refresh mutation survivors (#73)
- *(cli)* Keep the doctor Node-floor command test fast under full-suite load (#75)
- *(email)* Keep the #66 and #53 test addresses on reserved domains
- Node floor partial versions; email-poll run-line shape, non-Error throws, close after a pre-gog failure (#75, #66)
- Doctor Node seam, default Node stub, exact-entry whole-address match (#75, #53)
- Kill surviving mutants (Node floor 0 parts, first error line exact, auth errors with timeout text, JSON Schema pattern case, entry end anchor) (#75, #66, #53)
- *(email)* Keep the non-Error run-line test address off a literal file name (no-instance-data) (#66)
- *(email)* Reserved domains and formatting for the review-fix tests (#53, #66)
- *(cli)* Run the doctor exit-code test at the Node floor, not the host's Node (#75)

### ⚙️ Miscellaneous Tasks

- .prettierignore for the changelog and respond fixtures; format the tsconfigs
- Release @karmaniverous/jeeves-scripts-core v0.3.0
## [0.2.2] - 2026-10-26

### 💼 Other

- [51] feat(email): per-account reportOnly (accounts[].reportOnly)

Add optional pipeline.accounts[].reportOnly. An account's effective flag is emailConfig.reportOnly || accounts[].reportOnly === true, resolved by the new reportOnlyFor(pipeline) (config/report-only.ts) and used by every reader. The email-updates gate (label-actions enqueueEmailUpdates/enqueueLabelActions) drops each action whose own account is report-only; poll, backfill-historical, email-fetch, apply-labels, email-respond and meetings extract/catch-up all take the per-account policy. drain-updates drops (and logs) queued items for an account that is report-only on its own, without calling gog. email-apply-labels skips report-only accounts and refuses only when every target account is report-only.
- [51] docs(email): per-account reportOnly in guides, meetings job and jeeves-email skill

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-scripts-core v0.2.2
## [0.2.1] - 2026-10-18

### 💼 Other

- [37] fix(slack): save the read position per message and budget each channel's backlog (#37)

slack-poll now processes history oldest first and saves the channel's read position after each top-level message and its replies, so a run killed mid-channel resumes there. A channel stops starting messages after slack.backfillBudgetSeconds (default 60; at least one message always), logs the backfill and hands off, so a backlog can't starve the channels after it. New optional slack.newChannelLookbackDays sets where a channel with no position starts (0: from now; seeded as its position so a quiet channel doesn't slide forward). channel_not_found logs as a SKIP warning. A cursor-store failure still aborts the run.

Closes #37
- [37] fix(slack): read history a page at a time within the channel budget (#37)

fetchHistory fetched every page (1.2 s apart) before writing anything, so a long backlog could still outlast the job timeout without saving a position. fetchHistoryPage reads one page just after oldest (Slack anchors to oldest when latest is unset); pollChannel fetches each next page from the position just saved and checks the budget between pages. Addresses Copilot review on #39.

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-scripts-core v0.2.1
## [0.2.0] - 2026-10-18

### 💼 Other

- [14-15] fix(dispatchers): --dry-run never starts a worker session, with or without slack (#15)

With slack, --dry-run now reads Slack, builds the TASK and prints a one-line report (job, task length, allowed post targets), then stops. The 'real worker, posts printed' mode is removed. dispatchTaskFile resolves 'previewed' for --dry-run on both paths.
- [14-15] test(worker-slack): type the runWorkerSlackJob mock from the module (#15)
- *(google-drive)* Replace inline base64 images with placeholders; add --reconvert (#20)
- [14-15] feat(cli): runnables declare their flags; run checks them and prints run <id> --help (#14)

defineJob({ flags, positionals }) declares the accepted flags (lib/args specs, now with descriptions); the job reads them parsed from ctx.flags. run <id> rejects an undeclared option, an unexpected positional or a valued option without a value (exit 1, before the body runs) for a runnable that declares flags, and passes everything through with a deprecation warning for one that declares none (strict for all in a later minor). run <id> --help prints usage, description, flags and the effective manifest without running the body. Every core runnable declares its flags and reads them through ctx.flags (enforced by flags-discipline.test.ts); dispatchers share dispatcherFlags. job.run({ args }) without flags still works: the job parses them itself.
- *(email)* Email-respond assistant-mailbox auto-reply (#22); review and Copilot fixes

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-scripts-core v0.2.0
## [0.1.3] - 2026-10-14

### 🐛 Bug Fixes

- *(release)* GitHub release notes and changelog use the new version tag

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-scripts-core v0.1.3
## [0.1.2] - 2026-10-12

### 🐛 Bug Fixes

- *(slack)* Keep a channel's existing directory when renaming it fails
- *(slack)* Narrow a rename error's code before naming it in the warning

### 💼 Other

- Extended test timeouts

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-scripts-core v0.1.2
## [0.1.1] - 2026-10-12

### 💼 Other

- Label the release's own commits with its version in CHANGELOG and release notes

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-scripts-core v0.1.1
## [0.1.0] - 2026-10-12

### 🚀 Features

- Add packages/core and packages/template workspaces (Decision 20)
- *(config)* Config schema, silo resolver and config-check CLI ported from jeeves-scripts-template@322054c
- *(config)* [**breaking**] Drop the deprecated forwardJGS alias; emailConfig.receipt is strict
- *(config)* ImapSecretPath/resolveImapPassword default to paths().imapSecretsDir; port imap-secrets tests (found migrating JGS, Decision 30)
- Copy jeeves-scripts-template main@322054c into core wholesale (Decision 32)
- *(core)* Export every built module as @karmaniverous/jeeves-scripts-core/<path> (instance deep imports during Decision 32)
- *(cli)* Jeeves-scripts run <job-id> (Decision 16)
- *(dispatchers)* Hoist JGS's task-file dispatcher into core, silo-aware (Decisions 23, 28)
- *(lib)* Read other components' settings from their own config
- *(slack)* Channel decisions in slack.channels, Slack facts from Slack
- *(skills)* Core ships its own skills
- *(skills)* Ship jeeves-standing-meetings and jeeves-dates
- *(people)* People registry in config and its resolver
- *(people)* Resolve listed people at every identity site
- *(people)* Read-only people proposal from Slack
- *(slack)* Relocate-archives moves Slack archives to the right silo
- *(email)* Email apply-labels catches up classification labels
- *(email)* People fields on downloaded Gmail message records
- *(jobs)* DefineJob, the core job registry and core manifests; run resolves through the registry
- *(core)* [**breaking**] Remove the daily digest; apply the approved admin renames (plan rows 36, 37)
- *(core)* [**breaking**] Narrow the exports to the root API; conversion utilities (plan rows 39, 59)
- *(core)* [**breaking**] People-propose and email-apply-labels runnables; descriptions; naming at registration (plan rows 54, 56, 57, 58, 61)
- *(core)* [**breaking**] Remove the extensions config key (plan row 40)
- *(core)* [**breaking**] The instance plugin, instance manifests and list (plan rows 38, 55, 58, 60)
- *(core)* Thin convert runnables convert-pdf-to-md and convert-docx-to-md (plan row 59)
- *(core)* Doctor (plan row 42)
- *(core)* [**breaking**] The template as a usable instance repo (plan row 43)
- *(core)* Init and the init-from-tarball CI job (plan row 44)
- *(core)* Skills install | uninstall | status, JEEVES_SCRIPTS_DIR skill paths (plan row 45)
- *(core)* The global hand-off (plan row 46)
- *(admin)* Admin-report-token-metrics runnable; getTokenMetrics({ from, to })
- *(cli)* Config check registers the plugin and validates manifests and deltas as list does
- *(core)* --print-task and --dry-run for every task-file dispatcher (review docs D-2)
- *(core)* Root-export the runnable argument parser and a Slack Web API client (Decision 59)

### 🐛 Bug Fixes

- Pin explicit outDir in packages/core/tsconfig.build.json
- Carry JGS's unreleased fixes into core (J8)
- *(jira)* Sort-backlog reads integrations.jira.boardId (env JIRA_BOARD_ID fallback)
- *(cli)* Validate jobs/*.json with Zod; fail on malformed entries (Decision 31)
- Name jeeves-scripts.json, not pipeline-config.json; ship the rate card seed from core
- *(package)* Ship CHANGELOG.md, as the package README says
- *(slack)* A DM belongs to the workspace of the account that reads it
- *(google-drive)* Meta seeding uses the meta service's configured address
- *(cli)* People propose --out guard ignores case
- *(email)* Trim-jsonl keeps lines whose age is unknown
- *(x)* Like/repost fail queue items the action did not perform
- *(convert)* Quote YAML frontmatter values
- *(convert)* Always destroy the pdf-parse parser
- *(email)* Parse IMAP poll state with a Zod schema
- *(slack)* Cap inlined file content at 256 KiB
- *(core)* Tsx is a runtime dependency (plan row 38)
- *(cli)* Main() resolves to 1 with one stderr line on run/list failures
- Messages, TSDoc and guides name jeeves-scripts.json keys, not constants.ts
- *(cli)* Doctor shows prerequisite state; hand-off drops help, hints npm install; skills failures on stderr, uninstall leaves no empty objects
- *(jobs)* Manifest JSON errors name the file; writtenFor is an exact semver; init errors name the value
- TaskFileDispatcher returns a run; admin crash labels; JIRA_BOARD_ID validated; stale TSDoc
- *(cli)* No help verb; --help lists only the six verbs
- *(core)* Runnables hand back their work; no process.exit; drain and session-refresh tests (review SOLID-1, SOLID-2, COV-1, COV-2, WT-1, OTH-3)
- *(core)* --config wins over a cached config; inert deltas fail (review docs C-1 code side done earlier, email-apply-labels --config, R-6)
- *(core)* The tsconfig preset excludes the instance's coverage/, dist/ and node_modules/ (Decision 58)
- *(core)* Address Copilot review of PR #6 (typed X client, fake fetch headers, stale guides)

### 💼 Other

- *(config)* Draft config and silo domain ported from jeeves-scripts-template@322054c (not yet gate-clean)
- Load rollup.config.ts natively instead of via --configPlugin (removes outputToFilesystem warning and .rollup.cache)
- Retire the Decision 32 legacy machinery
- Keep *.test-helper.ts out of the package
- *(openclaw-db)* Name test-only fixtures *.fixtures.ts so they don't ship
- Revert "chore(release): release:pre publishes 1.0.0-rc.N"

This reverts commit 9031dd9d701a85aa874684fc38b6bac8deb190bf.
- Revert "chore(release): next core release is 0.1.0 (release bumps minor)"

This reverts commit ca9ea201a47fc7d661fd24f252eac011d61a27f9.
- *(core)* Presets authored in TypeScript, shipped compiled (Decision 52)
- TypeDoc and release-it configs in TypeScript (Decision 52)
- *(core)* Init names the package after its folder (Decision 53, Q33)
- *(core)* JIRA_BOARD_ID wins over integrations.jira.boardId (Decision 53, Q25)
- *(core)* A manifest's timeout is optional, as in the runner (Decision 54, Q37)
- *(core)* Admin-check-qdrant-health schedule names its time zone (Decision 54, Q39)
- *(core)* Manifest schedules take exactly the runner's forms (Decision 54, Q38)
- *(core)* Config check validates the plugin's local block (Decision 54, Q40)
- *(core)* Config check pins JEEVES_SCRIPTS_CONFIG before loading the plugin (Decision 54, Q40)
- *(core)* Admin-sweep-orphaned-tmp sweeps jobs.<id>.extraDirs too (Decision 55, Q43)

### 🚜 Refactor

- Lib, slack, calendar, core, meta, linear, dispatchers and convert pass the strict gates (Decision 32)
- X, google-drive, jira and github pass the strict gates (Decision 32)
- Email, meetings and admin pass the strict gates; legacy list empty (Decision 32)
- *(lib)* One OpenClaw config reader for gateway and Slack bot tokens
- *(lib)* Split spawn-worker; test spawn retry, gatewayInvoke and the email cache
- *(linear)* Validate the Linear config with Zod; test linearQuery and the paginators
- *(slack)* Split poll.ts into single-purpose modules
- *(x)* Split x-api into client, OAuth, timelines and actions
- *(meetings,admin)* Split extract, doc-fetch and session-refresh
- *(meetings,email)* Split the migrations, fathom-extract and imap/poll
- *(email)* Decompose fetchThreadMetadata
- *(email)* Move the gog account poll out of email/poll
- *(lib)* One OpenClaw state-dir lookup
- *(slack)* Channel workspace lives in the Slack cache
- [**breaking**] Core ships only behaviour every instance needs
- *(config)* [**breaking**] Remove emailConfig.receipt
- *(core)* Enforce the 300-line limit with max-lines; split the registry and four tests
- *(core)* Settle the root export before v0.1.0 and pin it with a test
- *(core)* GitHub, calendar and email jobs take their collaborators as parameters; no config read at import (review testability refactor, SOLID-7, DRY-9 partial)
- *(core)* Meta, Slack, Google Drive, admin glue and worker-session take their collaborators; tests (review testability refactor, DRY-5, DRY-9)
- *(core)* Meetings take their collaborators; per-file coverage gate; no help subcommand (review testability refactor, COV rows, D57, dead code)
- *(core)* One retry helper, shared walks and fixtures (review DRY-4, DRY-5, DRY-6, DRY-7, DRY-8, DRY-10, DRY-11, WT-2, WT-F1, WT-F2)

### 📚 Documentation

- *(config)* Export and document every config schema and resolved type (TypeDoc zero warnings)
- Google-drive spec and token-metrics runbook move here from the instances (guides/)
- Ship README, LICENSE, domain docs, guides and JSON Schema in the core package
- Sync core docs and usage text with jeeves-scripts.json and the launcher
- Authored docs live in guides/, TypeDoc output stays in docs/
- *(people)* Document the people registry and people propose
- *(people)* Example person is jane-doe
- Drop instance-specific names, ids and paths from core
- *(google-drive)* Trim instance spike and verification notes from the design record
- *(admin)* Pending-models add/prune race is self-healing, not lossless
- *(jobs)* Guides/jobs.md (registry, defineJob, manifests, deltas); run resolution and job ids across the guides
- Guides and READMEs match the design (plan row 48)
- *(linear)* The Linear config default is {credentialsDir}/linear.json
- *(core)* TSDoc and the email guide name the runnables, not the removed verbs
- *(guides)* Config check registration, doctor states, skills uninstall, override labels, hand-off before npm install
- *(core)* Fix every core docs-review row (review docs C-1..R-11 core rows, D-1, J-1, J-2, F-1, OTH-4, OTH-6)
- Render the guides as one TypeDoc Guides section

### 🎨 Styling

- *(jira)* Sort imports

### 🧪 Testing

- *(admin)* 30 s timeout for the SQLite-fixture collector tests
- Example Slack account is work, not vc
- Neutral base root in path and config tests
- Instance-agnostic guard with one documented deny list; remove instance names, paths and ids from core
- *(admin)* SQLite fixtures skip per-statement fsync; 30 s timeout for the collector-graph tests
- *(core)* Replace weak tests, drop test-only exports (review WT-4, WT-5, WT-6, WT-7, WT-8, WT-10, OTH-2)
- *(core)* Cover the Windows branch of isSamePath on every platform (CI coverage gate on Ubuntu)
- *(core)* Neutral placeholders for instance-looking values (AGENTS.md sweep)
- Create directory links as junctions so tests pass without symlink privilege

### ⚙️ Miscellaneous Tasks

- *(core)* Replace the instance-agnostic deny list with authoring instructions
- *(core)* Cheap spec/code mismatches from audit 2 (help text, PR template, TSDoc, engines)
- Release @karmaniverous/jeeves-scripts-core v0.1.0

### ◀️ Revert

- *(slack)* Take relocate-archives out of core
