# Fabric Pass — Ideas

<!-- One "## [STATUS] [<owner>] IDEA-NNN — Title" section per idea.
     Statuses: DRAFT → TODO → TAKEN → DONE. Terminal: DROPPED, PARKED.
     Owner required for DRAFT/TAKEN/DONE; omitted for TODO; retained for DROPPED/PARKED.
     Identifier is a bare login (no prefix); the registry uses the value verbatim.
     Body must fit in a single "Idea:" line by default; pad only when the simple
     form genuinely won't carry the information, otherwise split into multiple ideas.
     Format and rules: .claude/skills/ideas/SKILL.md -->

## [DONE] [frontgeeks] IDEA-000 — Improve profile view & editing logic
Idea:
Default the profile form to a locked, view-only mode instead of always-editable, to avoid accidental edits. A pencil-icon "Edit" button ("Modify profile" hint), top-right of the form on the same line as the "Contributor Profile" title, switches it into edit mode — today's always-editable behavior, unchanged autosave, unchanged title. A "Save" button, shown only in edit mode, switches the form back to view-only mode.

Expected outcome:
- View-only mode is the default on load; fields aren't editable and provider links can't be changed until Edit is pressed.
- Edit button (pencil icon + "Modify profile" hint) sits top-right, same line as the title, and switches to edit mode.
- Save button (edit mode only) switches back to view-only mode.
- Pressing Save enforces the mandatory fields — Name and Email must be filled in, or Save is blocked and the contributor is prompted to fill them in.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/9 (merged; IDEA-000 landed as fd7537c)

Task: https://github.com/constructorfabric/fabric-pass/issues/1

By: vzhuman · 2026-07-31

## [DONE] [frontgeeks] IDEA-001 — Dedicated profile page
Idea:
The profile view/edit form becomes its own page, opened via "Profile" in the top-right menu, and closed via a new Close button (an "X" with a "Close" hint), placed near the Edit (pencil) button. A new static Main page (placeholder content only, "Main Form", for now) is what closing the Profile page returns to, shown in its already-saved state.

Expected outcome:
- Profile is a separate page from Main, reachable via the top-right menu's "Profile" item.
- A Close button (X icon, "Close" hint), near the Edit button, returns to Main.
- Main is a new, static page — for now just a placeholder reading "Main Form" — shown in its saved state after Profile is closed.
- On sign-in, Main is shown if the contributor's profile is considered complete; otherwise the Profile page opens directly in edit mode.
- View mode on the Profile page disallows editing any field and disallows linking/re-linking Telegram, Discord, or any other provider — those actions are edit-mode only.

Notes:
Depends on IDEA-000's view/edit mode split — "view mode disallows editing" only means something once that mode exists.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/9 (merged; IDEA-001 landed as 353bf08)

Task: https://github.com/constructorfabric/fabric-pass/issues/2

By: frontgeeks · 2026-07-31
By: vzhuman · 2026-07-31

## [DONE] [frontgeeks] IDEA-002 — Review of the database–git data exchange process
Idea: Review how data flows between the Postgres database and git (the cf-internal registry sync): what is exported, what is imported back, and whether the process holds up.
Result: review report on the task issue — https://github.com/constructorfabric/fabric-pass/issues/3#issuecomment-5176740537 (single-writer model sound; main risks: export silently reverts admin edits after a missed/partial sync, and sync can clobber app-set aliases)
Task: https://github.com/constructorfabric/fabric-pass/issues/3
By: frontgeeks · 2026-07-31

## [DONE] [frontgeeks] IDEA-003 — Root user configured via env by GitHub ID
Idea: A root user for the app, designated by GitHub ID through an environment variable.
Result: PR https://github.com/constructorfabric/fabric-pass/pull/11
Task: https://github.com/constructorfabric/fabric-pass/issues/4
By: frontgeeks · 2026-07-31

## [DONE] [vzhuman] IDEA-004 — Public contributor profile view
Idea:
A read-only page for viewing another contributor's public details — reachable by direct link now, and from search once IDEA-005 lands. Merges in everything recorded under any of that contributor's aliases, not just the row that was opened.

Expected outcome:
- Shows a contributor's public details: name, company, and every linked account they (or an alias of theirs) have.
- Discord/Telegram: click to open the corresponding app's chat with that person.
- Email: click to open a mail client addressed to them.
- GitHub: click to open their GitHub profile.
- Fields sourced from any of the contributor's aliases are merged into one view, not shown only from the row that was clicked into.
- No edit affordances anywhere — this is never the signed-in contributor's own editable form.

Notes:
Feeds IDEA-005 (contributor search) as its destination page.
Visible only to `confirmed` contributors (both as search results and as viewable profiles) — a `draft` contributor is neither searchable nor has a viewable profile page yet.
Transfer to frontgeeks on 2026-08-05 was made in error and reverted the next day — vzhuman remains the owner. An `internal`-status-gating note added at the same time was also a mistake — this page is gated on `confirmed`, not a not-yet-existing `internal` status.

Result: commit af56e5b — https://github.com/constructorfabric/fabric-pass/commit/af56e5b

Task: https://github.com/constructorfabric/fabric-pass/issues/12

By: vzhuman · 2026-07-31

## [DONE] [vzhuman] IDEA-005 — Contributor search on Main page
Idea:
A search box on the Main page for finding other contributors, opening the matching one in the profile view (IDEA-004).

Expected outcome:
- Matches against name, email, GitHub username, GitHub email, Discord username, and Telegram username.
- Live results appear once 3–4+ characters are typed, capped at the 5 best matches.
- Selecting a result opens that contributor's profile view (IDEA-004).

Notes:
Depends on IDEA-004 for the destination page.
Only searches, and only returns, `confirmed` contributors — a `draft` contributor doesn't show up as a search result.
Transfer to frontgeeks on 2026-08-05 was made in error and reverted the next day — vzhuman remains the owner. An `internal`-status-gating note added at the same time was also a mistake — this searches `confirmed` contributors, not a not-yet-existing `internal` status.
Also matches LinkedIn name — not in the original list above, which predates LinkedIn linking (IDEA-024); leaving it out once LinkedIn existed would have read as a gap rather than a deliberate omission.

Result: commit af56e5b — https://github.com/constructorfabric/fabric-pass/commit/af56e5b

Task: https://github.com/constructorfabric/fabric-pass/issues/13

By: vzhuman · 2026-07-31

## [DONE] [vzhuman] IDEA-006 — Community rules & policies on Main page
Idea:
A section on the Main page listing Constructor Fabric's community-wide rules and policies, most likely as links into the public governance repository's markdown documents, possibly alongside links to individual tracks' own policies.

Expected outcome:
- A visible list of policy/rules links on the Main page.
- Each link points at a markdown document in the governance repository.

Notes:
Open question, not yet decided: does a link navigate straight to the document (e.g. on GitHub), or open it rendered inside this app, in a new tab, with a link back to the source repository?
Track-specific policy links, if any, are out of scope until IDEA-007's track directory exists to hang them off of.
Approach: the list of links comes from IDEA-032's artifact-links registry (cf-internal `pass/`), not hardcoded or scraped from the governance repository directly — the registry holds the label and URL, the governance repository still holds the actual policy documents.
Depends on IDEA-032 for where these links are sourced from.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/35 (merged as 1ea196f)

Task: https://github.com/constructorfabric/fabric-pass/issues/29

By: vzhuman · 2026-07-31

## [DONE] [vzhuman] IDEA-007 — Track directory on Main page
Idea:
A directory of Constructor Fabric's tracks (Studio, Insight, Gears — with Gears Core/OSS/BSS/FrontX/Mobile as sub-tracks —, Research, Governance), each with a summary, its leaders and their roles, and links to its repositories.

Expected outcome:
- Every track (and sub-track) shows: a short summary of what it's about, its leaders with role (Product Manager, Architect, Developer, Researcher, etc.), and its repositories, each with a short description and a link to its issue tracker.

Notes:
Proposed addition, beyond what was asked — confirm before including: a link to the track's own community/discussion channel (e.g. its Discord channel), and a short "how to get involved" pointer. Both are cheap to add alongside the rest of this directory and squarely useful for a new contributor.
Roadmap diagrams (IDEA-008) and call schedules (IDEA-009) build on this directory rather than being part of it.
Depends on IDEA-010 for the underlying tracks data — nothing to display until that exists.
A track's entry can also surface its own artifact links (e.g. vision doc, contributing guide) from IDEA-032's registry, scoped to that track's slug — the same mechanism IDEA-006/008/009 use for their own links.
Depends on IDEA-032 for any artifact links shown alongside the rest of a track's entry.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/35 (merged as 1ea196f) — reconciled with IDEA-035 as list (/tracks) + detail (/tracks/[slug]).

Task: https://github.com/constructorfabric/fabric-pass/issues/30

By: vzhuman · 2026-07-31

## [DONE] [vzhuman] IDEA-008 — Track roadmap diagrams
Idea:
A roadmap diagram for each track, shown on its entry in the track directory (IDEA-007).

Expected outcome:
- Each track in the directory shows, or links to, a roadmap diagram reflecting its current plan.

Notes:
Depends on IDEA-007 for the directory to attach to. Diagram source/format (static image, embedded tool, generated from a tracked file) is undecided.
Approach: a diagram is a link into IDEA-032's artifact-links registry, pointing at wherever it's actually maintained (any repository under `constructorfabric`, or elsewhere) — this app never stores or generates the diagram itself, only the link to it.
Depends on IDEA-032 for where this link is sourced from.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/35 (merged as 1ea196f) — folded into the artifact-links registry (category `roadmap`), no bespoke UI.

Task: https://github.com/constructorfabric/fabric-pass/issues/31

By: vzhuman · 2026-07-31

## [DONE] [vzhuman] IDEA-009 — Track meeting schedules
Idea:
Each track's recurring calls, shown on its entry in the track directory (IDEA-007): daily sync-up, regular community update/demo call, and regular planning call.

Expected outcome:
- Each track in the directory lists its daily sync-up schedule, its regular community call schedule (updates and demos), and its regular planning call schedule.

Notes:
Depends on IDEA-007 for the directory to attach to. Whether schedules link out to an external calendar or are entered/maintained here directly is undecided.
Approach: a schedule is a link into IDEA-032's artifact-links registry (e.g. to an external calendar or a scheduling doc), not data entered/maintained directly in this app — consistent with IDEA-006/008 using the same registry for their own links.
Depends on IDEA-032 for where this link is sourced from.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/35 (merged as 1ea196f) — folded into the artifact-links registry (category `schedule`), no bespoke UI.

Task: https://github.com/constructorfabric/fabric-pass/issues/32

By: vzhuman · 2026-07-31

## [DONE] [vzhuman] IDEA-010 — Tracks data & cf-internal sync
Idea:
A `tracks` concept in the database, mirrored to and from a new file in cf-internal (`pass/tracks.yaml`), following the same pattern as the existing contributors registry sync.

Expected outcome:
- Each track has: a name, a description, a list of repositories (each with its own short description and issue-tracker link — matching what IDEA-007 already promised to display), and up to five named leader slots — Product Manager, Architect, Developer, Quality, Researcher — each independently either empty or pointing at exactly one contributor.
- A contributor can hold a leader slot on more than one track at once (e.g. Architect on one track, Product Manager on another).
- Synced with cf-internal's `pass/tracks.yaml`, mirroring `pass/contributors.yaml`'s bidirectional, single-writer-per-field design.

Notes:
The per-repository description/issue-tracker-link fields go beyond the source request's bare "list of repositories" — added because IDEA-007 already promised to display them, and they need somewhere to live. Confirm before building.
Prerequisite for IDEA-007/008/009 (nothing to display until this data exists) and for IDEA-011's Track Admin role, IDEA-013's join requests, and IDEA-014's per-track membership.
Pulled in as a direct prerequisite while implementing IDEA-011 — Track Admin has nothing to scope against otherwise. One-way sync only (file -> DB) — unlike contributors, nothing about a track is self-reported, so there's no export direction.

Result: commit 3cb589c — https://github.com/constructorfabric/fabric-pass/commit/3cb589c

Task: https://github.com/constructorfabric/fabric-pass/issues/16

By: vzhuman · 2026-07-31

## [DONE] [vzhuman] IDEA-011 — Contributor roles: Contributor / Track Admin / Admin
Idea:
Three levels of access: Contributor (default), Track Admin (scoped to one or more specific tracks), and Admin (internally "Organization Admin," but just "Admin" in the UI).

Expected outcome:
- Every contributor is a plain Contributor by default.
- Admin is a global role, held by zero or more contributors.
- Track Admin is per-track, not global — a contributor can be Track Admin of more than one track at once, and a track can have more than one Track Admin.
- Admin and Track Admin unlock additional pages/page-sections beyond what a plain Contributor sees (specifics in IDEA-012 and IDEA-014).

Notes:
Depends on IDEA-010 for tracks to scope Track Admin against.
Track Admin gates nothing yet — IDEA-014 (the page that would consult it) isn't built; the role and its data (track_admins) exist as groundwork, same as isRootUser was before this.

Result: commit 3cb589c — https://github.com/constructorfabric/fabric-pass/commit/3cb589c

Task: https://github.com/constructorfabric/fabric-pass/issues/14

By: vzhuman · 2026-07-31

## [DONE] [vzhuman] IDEA-012 — Admin: full contributor list with Confirm/Block
Idea:
A page, visible only to Admins, listing every contributor — unlike the plain-Contributor view, which only gets search (IDEA-005) with no full table. Admins can Confirm or Block a contributor from this list, changing their status.

Expected outcome:
- Admin-only page: the full contributor table, plus the same search as IDEA-005.
- Confirm and Block actions per row, each changing that contributor's status.

Notes:
`status` (draft/confirmed) is currently owned entirely by the cf-internal registry file — the app only ever reads it, never writes it (see README's "Contributors registry sync"). Confirm changing it from the app UI, and Block being a new status value at all, both need reconciling with that single-writer model before implementation: either this action becomes a second writer (and the sync direction for `status` has to change), or "Confirm"/"Block" here mean proposing a change that flows back out through the existing export instead of writing directly. Worth deciding before implementation.
Depends on IDEA-011 for the Admin role itself.
IDEA-021 (leave the community) hits this same single-writer question, from a different angle (self-service vs. admin-triggered) — worth deciding both together.
Decided: the app writes `status` directly (setContributorStatus) — simplest, matches the request literally. It folds back through the registry file on the next scheduled export; the accepted risk is a registry-file edit landing between an Admin's click and that export, which would overwrite the in-app change back on the following import. Blocked behaves exactly like draft everywhere status already gates something (search, public profile) — no additional restriction on signing in or editing your own profile.

Result: commit 3cb589c — https://github.com/constructorfabric/fabric-pass/commit/3cb589c

Task: https://github.com/constructorfabric/fabric-pass/issues/15

By: vzhuman · 2026-07-31

## [DONE] [vzhuman] IDEA-013 — Request to join a track
Idea:
A contributor can request to join a track from that track's page. The request is stored, synced to cf-internal, and visible to that track's Track Admin(s) (and to Admins).

Expected outcome:
- A "Request to join" action on a track's page (IDEA-007), available to any signed-in contributor.
- The request is persisted and synced into cf-internal alongside the rest of the tracks data (IDEA-010).
- Pending requests are visible to that track's Track Admin(s) and to Admins — see IDEA-014 for where they act on them.

Notes:
Depends on IDEA-010 (tracks must exist) and IDEA-007 (the track page this is requested from).

Result: PR https://github.com/constructorfabric/fabric-pass/pull/46 (merged as 5f5c6bd) — app-owned track_members table, not synced to cf-internal (contributor-initiated + admin-decided, same category as email confirmation).

Task: https://github.com/constructorfabric/fabric-pass/issues/39

By: vzhuman · 2026-07-31

## [DONE] [vzhuman] IDEA-014 — Track Admin: member list & join-request review
Idea:
A page, visible to Track Admins (and Admins), listing the people assigned to their track(s) plus that track's pending join requests (IDEA-013), with Accept/Reject actions on requests.

Expected outcome:
- A Track Admin sees only the members and pending requests for the track(s) they admin, not every track.
- A Track Admin managing more than one track sees all of them, not just one.
- Accept/Reject actions on a pending join request.
- Admins have the same Accept/Reject capability as a Track Admin, but across every track rather than just their own — an Admin can act on behalf of any Track Admin.
- Search, same as the plain-Contributor and Admin views (IDEA-005 / IDEA-012), scoped to the Track Admin's own track(s).

Notes:
Depends on IDEA-011 (roles), IDEA-013 (the requests being reviewed), and IDEA-010 (tracks and their membership).

Result: PR https://github.com/constructorfabric/fabric-pass/pull/46 (merged as 5f5c6bd) — /tracks/admin, linked from the account menu as "Track membership".

Task: https://github.com/constructorfabric/fabric-pass/issues/40

By: vzhuman · 2026-07-31

## [DONE] [vzhuman] IDEA-015 — Onboarding checklist for new contributors
Idea:
A "getting started" checklist on the Main page for a contributor whose profile isn't yet complete, tying together pieces that already exist separately: fill in the profile, read the community policies, join a track.

Expected outcome:
- Shown to a signed-in contributor until their profile is considered complete (same completeness check as IDEA-001).
- Steps: complete profile (name + email — IDEA-000's mandatory fields), read community policies (IDEA-006), request to join a track (IDEA-013).
- Each step links straight to the relevant page/action; completed steps show as done.

Notes:
Depends on IDEA-000 (mandatory-field/completeness concept), IDEA-006 (policies), and IDEA-013 (join request) all existing first — this is a thin layer tying them together, not a new capability on its own.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/48 (merged as c36e0bd) — visibility gated on IDEA-034's full completeness, not just IDEA-000's original mandatory-field check.

Task: https://github.com/constructorfabric/fabric-pass/issues/41

By: vzhuman · 2026-07-31

## [TODO] IDEA-016 — Open-issue board across track repositories
Idea:
A board aggregating open, contributor-friendly issues (e.g. "good first issue") from every repository listed under every track, so a new contributor can find something to work on without hunting through each repo individually.

Expected outcome:
- Pulls open issues from the repositories listed in IDEA-010's tracks data, filtered to some contributor-friendly label convention.
- Shown somewhere reachable from Main — a dedicated section or its own page.
- Each issue links out to the real issue on GitHub (or wherever the repo is hosted).

Notes:
Depends on IDEA-010 for the repository list. Needs its own GitHub API access (rate limits, possibly a token) — worth scoping separately before committing to it.
Split from IDEA-015 rather than folded in — it's a materially different piece of engineering (external API integration) from the rest of the onboarding checklist.

By: vzhuman · 2026-07-31

## [TODO] IDEA-017 — Leave a track
Idea:
A contributor can remove themselves from a track they're a member of, from that track's page — the voluntary counterpart to IDEA-013's join request, distinct from being removed by an admin.

Expected outcome:
- A "Leave track" action on a track's page, shown only to a contributor who's currently a member of it.
- Takes effect immediately, no approval needed (unlike joining).
- Synced to cf-internal the same way membership changes from IDEA-013/014 are.

Notes:
Depends on IDEA-010 (track membership existing at all) and IDEA-013/014 (the membership this removes).

By: vzhuman · 2026-07-31

## [TODO] IDEA-018 — Volunteer for an open track leader slot
Idea:
A contributor can nominate themselves for one of a track's empty leader slots (Product Manager, Architect, Developer, Quality, Researcher — IDEA-010), the leadership counterpart to IDEA-013's membership join request.

Expected outcome:
- On a track's page, each empty leader slot shows a "Volunteer" action; filled slots don't show it.
- The nomination is visible to that track's Track Admin(s)/Admins for approval, the same way IDEA-013's join requests are (IDEA-014).

Notes:
Depends on IDEA-010 (leader slots) and IDEA-014 (the review surface this needs, extended to cover leader nominations alongside membership requests).

By: vzhuman · 2026-07-31

## [DONE] [vzhuman] IDEA-019 — Notify a contributor when their join request is decided
Idea:
When a Track Admin (or Admin) accepts or rejects a join request (IDEA-013/014), the requesting contributor is told the outcome — currently nothing surfaces the decision back to them at all.

Expected outcome:
- Some visible signal to the requester once their request is accepted or rejected — at minimum, a status shown on the track's page or their own profile; email is a possible channel given Resend is already wired up, but not assumed here.

Notes:
Depends on IDEA-013/014 for the decision this reports. Notification channel (in-app only vs. also email) is undecided.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/46 (merged as 5f5c6bd) — in-app status on the track page, plus a best-effort email via the existing Resend integration.

Task: https://github.com/constructorfabric/fabric-pass/issues/42

By: vzhuman · 2026-07-31

## [TODO] IDEA-020 — Discord announcements bell icon
Idea:
Announcements are posted to a Discord channel, not duplicated into this app. A bell icon somewhere in the UI reflects whether the signed-in contributor's linked Discord account has unread messages in that channel; clicking it opens the channel in Discord.

Expected outcome:
- A bell icon, visible when the contributor has linked Discord.
- Indicates unread state in the announcements channel for that contributor's account, if Discord's API can expose that for a linked account.
- Clicking it opens the announcements channel in Discord — no announcement content is ever rendered inside this app.

Notes:
Open question, needs research before committing to this shape: can Discord's API report per-channel unread state for an arbitrary linked account from a server-side integration, or only from a client the user is actually running? If not, this idea reduces to a plain static link to the channel with no unread indicator.

By: vzhuman · 2026-07-31

## [TODO] IDEA-021 — Leave the community (self-service)
Idea:
A contributor can remove themselves entirely. Their status becomes `left`, non-private fields get a `#left#ddmmyy-hhmmss` postfix, and private fields (Full Name, Email) are masked rather than deleted outright — e.g. "John Doe" → "J**** D****", "john.doe@gmail.com" → "j****@g****.com".

Expected outcome:
- A self-service "Leave the community" action, available to a signed-in contributor for their own row only.
- Sets `status` to a new `left` value.
- Full Name and Email are masked: each space-separated name part, and each of the email's local-part and domain-before-the-first-dot, becomes its first letter followed by four asterisks (matching the examples given); the rest of the email (the dot and TLD) is left intact.
- Non-private fields get a `#left#ddmmyy-hhmmss` postfix appended, timestamped to when they left.

Notes:
Open question from the request itself: which fields count as "non-private" for the postfix — GitHub username, Discord username, and company were suggested, but not confirmed.
Gap not covered by the request: Telegram phone number is on the contributor record and reads as at least as private as email — needs an explicit decision (masked like email, treated as non-private with a postfix, or cleared outright), not left implicit.
Masking rule above is my best reading of the two worked examples, not a formal spec — worth confirming against a few more real names/emails (short names, single-word emails, a domain with no dot before the TLD) before building it.
Written here as lowercase `left` to match the existing `draft`/`confirmed` convention (CONTRIBUTOR_STATUSES) rather than the literal uppercase `LEFT` — flag if uppercase is actually wanted.
Same single-writer concern as IDEA-012: `status` is currently owned by the cf-internal registry file, and this is a second, self-service writer to it.

By: vzhuman · 2026-07-31

## [DONE] [vzhuman] IDEA-022 — Audit log for admin operations
Idea:
A record of every admin/Track-Admin action taken through the app — Confirm/Block (IDEA-012), Accept/Reject (IDEA-014) — so there's accountability for who changed what and when.

Expected outcome:
- Every such action is logged: who did it, to whom, what changed, and when.
- Visible to Admins (scope for Track Admins — their own tracks only, or none at all — undecided).

Notes:
Registry-file-driven changes (editing pass/contributors.yaml or pass/tracks.yaml directly) already have their own audit trail via git history — this idea covers only actions taken in-app, which don't.
Depends on IDEA-012/014 existing as the actions being logged.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/47 (merged as c6eb9a8) — Admin-only, no Track Admin view.

Task: https://github.com/constructorfabric/fabric-pass/issues/43

By: vzhuman · 2026-07-31


## [DONE] [frontgeeks] IDEA-023 — Idempotent email confirmation link
Idea:
A confirmation link stops working the moment anything touches it once (confirmEmail consumes the token before checking anything), and every resend rotates the token, killing all previously sent emails. Real failure seen in production: contributor pressed Confirm twice, opened the newest email, got "That confirmation link is not valid" while the address was in fact confirmed by an earlier request (link scanner or double navigation). Fix: confirmEmail reports already-confirmed as success instead of invalid and no longer destroys the token on success; resendConfirmationEmail re-sends the existing unexpired token instead of rotating it.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/6 (merged as d62d49c)

Task: https://github.com/constructorfabric/fabric-pass/issues/5

By: frontgeeks · 2026-08-03

## [DONE] [frontgeeks] IDEA-024 — LinkedIn on the contributor profile
Idea:
Add LinkedIn to the contributor profile alongside GitHub/Discord/Telegram, so community members can reach each other professionally. Open question: a linked account via OAuth like Discord/Telegram, or a typed profile-URL field — LinkedIn's OAuth (OpenID Connect) readily proves account ownership, but its API is restrictive, so the typed field may be the pragmatic start.

Notes:
Creating the LinkedIn application itself (developer-portal app, OAuth credentials for the deploy env) is a companion task owned by vzhuman: https://github.com/constructorfabric/fabric-pass/issues/8.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/10 (merged; landed as 478867e..c97db50). Feature stays hidden on a deploy until LINKEDIN_CLIENT_ID/SECRET are both set (issue #8).

Task: https://github.com/constructorfabric/fabric-pass/issues/7

By: frontgeeks · 2026-08-04

## [DRAFT] [vzhuman] IDEA-025 — Staging environment for pre-merge verification
Idea:
A staging environment — a running deployment of the app, separate from production, so a change can be verified end-to-end (real Docker image, real Postgres, real OAuth sign-in, real Caddy/TLS) before it's merged to `main` and goes live.

Expected outcome:
- A change can be deployed somewhere real and clicked through — sign in, autosave, provider linking, email confirmation — before it reaches `pass.cfabric.org`.
- Staging never holds real contributor data and never touches the real cf-internal registry.

Recommended approach:
- A second, minimal droplet (~$6/mo, same 1 vCPU/1GB spec and hardening as production — see `cfabric-pass-setup.md`), at its own subdomain (e.g. `staging.pass.cfabric.org`), running the same Compose stack under a different `COMPOSE_PROJECT_NAME`.
- Its own, empty Postgres — never a copy of production data. If a test needs data, seed synthetic contributors, not real ones.
- Its own OAuth app registrations at GitHub/Discord/Telegram (and LinkedIn once IDEA-024 lands) — a redirect URL is bound to one exact domain (see the setup doc), so staging genuinely needs its own four app registrations, not a shared one. This is the real recurring cost of doing this properly.
- `RESEND_API_KEY` left unset on staging (confirmation emails log instead of send) unless someone specifically needs to test the email path, so test traffic doesn't burn Resend's send quota or deliverability reputation.
- `CONTRIBUTORS_EXPORT_SECRET`/`CONTRIBUTORS_SYNC_SECRET` left unset — staging should never write into or read from cf-internal's real `pass/contributors.yaml`.
- Deploy trigger: a second, near-identical GitHub Actions workflow that builds and deploys to the staging droplet on push to an open PR targeting `main` (or on manual `workflow_dispatch`), rather than a separate long-lived staging branch that can drift from `main`. Only one PR's changes live on staging at a time — a queue, not a blocker, for a team this size.

Notes:
Main cost/friction: doubles the monthly hosting bill and, more significantly, requires four more OAuth app registrations to create and keep in sync with production's redirect-URL pattern.
Alternative considered and rejected: a second stack on the *same* droplet. Production already needed a 2GB swap file just to run one stack comfortably (see the setup doc's Swap section) — a second concurrent Postgres+Next.js stack on the same 1GB box is a real OOM risk, not just an inconvenience.
Alternative considered and rejected: true per-PR ephemeral environments (a fresh subdomain per PR, torn down on merge). Doesn't fit this app's OAuth-gated design — every provider requires an exact, pre-registered redirect URL, so a genuinely ephemeral per-PR domain can't complete an OAuth flow without registering (and cleaning up) an app per PR, which is more overhead than it saves.

By: vzhuman · 2026-08-04

## [DONE] [vzhuman] IDEA-026 — Fix silently-broken redeploys from a full disk
Idea:
Production had been stuck 24 hours behind despite ~15 successful CI runs in between — every pull was failing with "no space left on device" (disk 99% full, 32 dangling images from five days of un-pruned deploys, 17.47GB reclaimable). The webhook logged the failure but nothing surfaced it, and the app container just kept serving whatever it already had, so the outage was invisible until someone actually compared "workflows completed" against "what's actually live."

Expected outcome:
- Disk freed and today's actual latest commit deployed to production immediately.
- The webhook prunes dangling images after every successful deploy, so this can't silently recur.

Result: commit eab2d08 (deploy/webhook/server.mjs) — https://github.com/constructorfabric/fabric-pass/commit/eab2d08

By: vzhuman · 2026-08-04

## [DONE] [vzhuman] IDEA-027 — Droplet operational metrics, sourced
Idea:
Expose the production droplet's CPU, RAM, disk usage, and disk I/O to the app server-side, so IDEA-028's footer section has something real to display.

Expected outcome:
- CPU, RAM, disk usage, and disk I/O utilization are readable from the app as percentages, refreshed periodically rather than fetched live on every page load.
- Disk usage is read as a current snapshot, not averaged — it moves slowly and steadily (today's IDEA-026 incident was a gradual fill, not a spike), so an hourly average would blur exactly the moment it matters, crossing a threshold.
- CPU, RAM, and disk I/O are averaged over the last hour — all three genuinely fluctuate minute to minute, and an hourly average smooths that noise without going so long (e.g. 24h) that a real, ongoing spike gets diluted into invisibility.

Notes:
Recommended source: DigitalOcean's Droplet Monitoring API, via a read-only DO API token (a new deploy secret, staged the same optional way as RESEND_API_KEY/LINKEDIN_CLIENT_ID). Open prerequisite to verify: DO's monitoring metrics require the `do-agent` installed on the droplet — unconfirmed whether it's already present on this one (not part of cfabric-pass-setup.md's server-base-setup steps).
Alternative considered and rejected: reading `/proc`, `/sys`, or Docker stats directly from inside the app container, which would need mounting host paths or the Docker socket into the app — the same "host-root-equivalent power" already flagged as a real risk for the webhook container (cfabric-pass-setup.md's Implementation notes under Step 6), and the app is the public-facing, larger-attack-surface service, not a narrow bearer-token-gated one. Calling out to the DO API instead keeps the app itself unprivileged.
Depends on nothing existing in this app yet; IDEA-028 depends on this.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/50 (merged as af8dd44) — `do-agent` confirmed running on the droplet. Gated behind new optional `DO_API_TOKEN`/`DO_DROPLET_ID` (unprovisioned in this environment — you'll need to generate a read-only DO token and set both before this shows live data). CPU/RAM/disk-usage math follows DigitalOcean's documented formulas, verified against their written docs, not against a live token — worth a sanity check once configured.

Correction (2026-08-10, once the token was actually provisioned): the "worth a sanity check" above turned out to matter. Disk I/O has no DigitalOcean droplet monitoring endpoint at all — confirmed via a direct call to `disk_read` returning a bare `404 page not found`, and absent from DO's published OpenAPI spec's full metric list (`bandwidth`, `cpu`, `filesystem_free`, `filesystem_size`, `load_1/5/15`, `memory_*`). Compounded by a real implementation bug: every metric was fetched in one `Promise.all`, so those two 404s discarded the three metrics (CPU/RAM/disk usage) that fetched successfully alongside them — nothing showed at all, not just a missing fourth box. Fixed in a follow-up PR: disk I/O removed (there's nothing to show), each metric now fetched and saved independently (`Promise.allSettled`, one failing metric can't blank the others), and a metric that fails on a later refresh keeps its last-known-good value instead of being overwritten with null.

Task: https://github.com/constructorfabric/fabric-pass/issues/44

By: vzhuman · 2026-08-04

## [DONE] [vzhuman] IDEA-028 — Admin-only droplet status section in the footer
Idea:
A section in the app's footer, visible only to Organization Admins, showing the production droplet's operational status — CPU, RAM, disk, and disk I/O (IDEA-027) — as four independent color-coded boxes (green/yellow/red), each with a hint on hover/tap showing its exact percentage.

Expected outcome:
- Only visible to a signed-in Admin (IDEA-011) — a plain Contributor or Track Admin never sees it.
- Four boxes: CPU, RAM, Disk, Disk I/O — each colored independently by its own value against its own threshold, not one blended overall status.
- Hovering (or tapping, on touch) a box shows its exact percentage.

Notes:
Suggested thresholds, not confirmed: green < 60%, yellow 60–85%, red > 85% — reasonable defaults, but worth agreeing on deliberately rather than treating these as settled.
Depends on IDEA-027 for real data to show, and IDEA-011 for the Admin role to gate on.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/50 (merged as af8dd44) — thresholds shipped as originally proposed (green<60/yellow60-85/red>85); Disk I/O uses MB/s cutoffs instead, since it has no natural percentage denominator.

Correction (2026-08-10): the footer is three boxes (CPU/RAM/Disk), not four — see IDEA-027's own correction. DigitalOcean has no disk I/O metric for droplets at all, so there was never a real percentage or MB/s figure behind that fourth box to show.

Task: https://github.com/constructorfabric/fabric-pass/issues/45

By: vzhuman · 2026-08-04

## [DONE] [vzhuman] IDEA-029 — Fix production 500 from a new required env var never added to the droplet
Idea:
IDEA-010/011/012's deploy (commit 3cb589c) added `TRACKS_SYNC_SECRET` as a required environment variable but the value was never added to the production droplet's `.env` before pushing — every request 500'd immediately after deploy, since `env.ts` validates the whole environment at module load and fails the entire app, not just the tracks routes, on one missing required variable.

Expected outcome:
- Production serving 200s again, with `TRACKS_SYNC_SECRET` actually present on the droplet.

Result: generated the secret directly on the droplet (`openssl rand -hex 32` appended to `/opt/fabric-pass/.env`) and force-recreated `app` — confirmed `/`, `/admin`, and `/profile` all back to 200 with no errors in `docker compose logs app`. Self-inflicted and caught within minutes of the deploy, not an independent discovery — recorded so the brief production 500 has a paper trail, and as a reminder: a new *required* env var needs to land on the target environment before the commit that requires it ships, not after.

By: vzhuman · 2026-08-05

## [DONE] [vzhuman] IDEA-030 — Wire up cf-internal's tracks.yaml and populate initial tracks
Idea:
IDEA-010 built the app-side one-way tracks sync (`/internal/tracks/sync`), but cf-internal never got the operational half: `pass/tracks.yaml` doesn't exist, the push-triggered workflow only watches `pass/contributors.yaml`, and `TRACKS_SYNC_SECRET` isn't set as a cf-internal Actions secret. This wires all three up and populates the initial set of real tracks (Studio, Insight, Gears, Gears BSS, Gears OSS, Research, Governance) with their leaders, admins, and repositories from the Constructor Fabric GitHub org.

Expected outcome:
- `pass/tracks.yaml` exists in cf-internal with the seven tracks above, repositories distributed across them, and descriptions drawn from constructorfabric.org.
- The workflow notifies fabric-pass on a `pass/tracks.yaml` push, same as contributors.
- `TRACKS_SYNC_SECRET` is set as a cf-internal Actions secret, matching the value already on the production droplet.
- The tracks table in production reflects the file after the first sync.

Result: no fabric-pass code change — cf-internal commits 80f691e (`pass/tracks.yaml` + sync workflow), f3874da (null out leader slots for people not yet in Fabric Pass), and 9f2ed7d (switch leaders/admins to GitHub logins). Verified live: 7 tracks in the production `tracks` table, matching the file.

Task: https://github.com/constructorfabric/fabric-pass/issues/17

By: vzhuman · 2026-08-06

## [DONE] [frontgeeks] IDEA-031 — Local dev sign-in without OAuth
Idea: Signing in on a local checkout currently needs its own registrations at GitHub, Discord and Telegram, since each redirect URI must match `APP_URL` exactly — a route that puts an existing contributor's `github_id` straight into the session, refusing to run anywhere but a local development server, would let a developer reach the signed-in and Admin views without any of that.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/19 (merged; landed as 4a1602d)

Task: https://github.com/constructorfabric/fabric-pass/issues/18

By: frontgeeks · 2026-08-06

## [DONE] [vzhuman] IDEA-032 — Community & track artifact links registry (cf-internal pass/*.yaml)
Idea:
A one-way-synced registry file in cf-internal's `pass/` folder, alongside `tracks.yaml`/`contributors.yaml`, listing links to interesting artifacts — both community-wide (e.g. policies) and per-track (e.g. vision, roadmap, meeting schedule) — without storing the artifacts themselves. Each entry is a label plus a URL pointing at wherever the real content actually lives: the governance repository for community policies, any repository under the `constructorfabric` org for a track's vision or roadmap, an external calendar for a meeting schedule, and so on.

Expected outcome:
- A synced table (mirroring `tracks`' one-way, file → DB, "file is the whole set" design from IDEA-010) holding entries with at minimum a label, a URL, and a scope (community-wide, or a specific track's slug).
- IDEA-006 (community policies), IDEA-007 (per-track links), IDEA-008 (roadmap diagrams), and IDEA-009 (meeting schedules) all read from this one registry instead of each inventing its own storage.

Notes:
Split out as its own idea rather than folded into IDEA-006/008/009 individually — it's one shared mechanism, not four separate storage designs.
Schema beyond the shape above is undecided: whether "scope" is a free-form track slug or an enum, whether entries carry a category (policy/vision/roadmap/schedule/etc.) for filtering or grouping, and whether one registry file covers everything or splits by concern (e.g. `pass/artifacts.yaml` vs. per-category files) are all open.
Depends on IDEA-010 (`tracks.yaml` already exists) for the per-track scoping to key against.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/35 (merged as 1ea196f) — `pass/artifact-links.yaml`, scope validated against `listTracks()` in application code (no DB FK, since `community` isn't a track), category enum `policy|vision|roadmap|schedule|discord|guide|other`.

Task: https://github.com/constructorfabric/fabric-pass/issues/33

By: vzhuman · 2026-08-06

## [DONE] [frontgeeks] IDEA-033 — MR step in the ideas flow: PR opens → In Test, merge → DONE
Idea: The ideas skill and CONTRIBUTING describe finishing as "set DONE, commit, push", skipping how the implementation itself lands — all development goes through a PR. Record the missing step: when an idea's implementation PR opens, its board item moves to **In Test**; only after the PR merges does the idea become `DONE` (with the merged PR as `Result`) and the item move to Done.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/21 (merged; landed as 5d34468)

Task: https://github.com/constructorfabric/fabric-pass/issues/20

By: frontgeeks · 2026-08-06

## [DONE] [vzhuman] IDEA-034 — Profile completeness status (Incomplete / Good Enough / Completed)
Idea:
A three-state completeness status for a contributor's own profile — proposed as Incomplete (default), Good Enough, and Completed, names open to something better — stored as a column on `contributors` and exported to `pass/contributors.yaml`, shown on the Profile view page to the profile's own owner, with an info icon explaining what's missing whenever it isn't fully Completed.

Expected outcome:
- Incomplete (default): at least one mandatory field (Full Name, Email, Company, Discord) is empty, or all four are filled but Email isn't confirmed.
- Good Enough: every mandatory field is filled and Email is confirmed, but at least one optional field is empty.
- Completed: every field is filled and Email is confirmed.
- The status is visible on the Profile view page, to the profile's own owner only (not on the public profile — IDEA-004).
- An info icon next to the status explains, in Incomplete/Good Enough, specifically what's still missing.

Notes:
Naming as given by the requester — open to a better set of names before implementation; "Ready" instead of "Good Enough" is one alternative worth considering (avoids reading like a grade, and doesn't risk being misread as the unrelated `status` field's own `confirmed` value).
Derived, not self-reported — computed from fields autosave already tracks, not something anyone hand-edits in the registry file. Should be app-owned and export-only into `pass/contributors.yaml`, the same one-way pattern `email_confirmed_at` already uses (README's single-writer model) — never read back in from the file.
"Optional field" needs a concrete list before implementation — every non-mandatory field on the profile (LinkedIn, Telegram), or a specific subset.
Feeds IDEA-036's Admin-page completeness column/filter. Could later replace IDEA-015's simpler binary completeness check for the onboarding checklist, though that's not required for this idea itself.
Named Incomplete/Ready/Complete — "Ready" chosen over "Good Enough" per the alternative above. Optional fields are Telegram and LinkedIn (LinkedIn only counted when enabled on the deploy — see profile-completeness.ts's computeProfileCompleteness).

Result: PR https://github.com/constructorfabric/fabric-pass/pull/25 (merged as 05c999d)

Task: https://github.com/constructorfabric/fabric-pass/issues/23

By: vzhuman · 2026-08-06

## [DONE] [vzhuman] IDEA-035 — Track page rendered from a markdown template
Idea:
A dedicated page per track, rendered from a markdown template stored in cf-internal with placeholders filled in from the tracks data (`pass/tracks.yaml`) — rather than a directory of inline summary cards, each track gets its own full page built from one shared, editable template.

Expected outcome:
- A markdown template in cf-internal defining the shape of a track's page, with placeholders for its name, description, leaders, repositories, and any other tracks data field.
- Fabric Pass renders that template per track, substituting each track's own data into the placeholders, and serves the result as that track's page.

Notes:
Overlaps with IDEA-007 (Track directory) — IDEA-007 describes *what* a track's entry shows (summary, leaders, repositories); this idea proposes a specific *how*: server-rendered from a shared markdown template rather than a purpose-built component. These are two different implementations of overlapping content, not additive — worth reconciling with IDEA-007 before building either.
"tracks/*.yaml files" (plural, as given) doesn't match the current data shape — IDEA-010 shipped one `pass/tracks.yaml` holding every track, not a file per track. Read literally this would mean restructuring already-live, already-synced data; more likely the request just means "sourced from the tracks data" loosely. Needs confirming before implementation.
Template format/placeholder syntax is undecided.
Natural home for IDEA-008 (roadmap diagrams) and IDEA-032 (artifact links) once those exist, alongside the rest of a track's page.
Marked DRAFT rather than TODO specifically because of the IDEA-007 overlap above — recording it shouldn't read as two approved, independently-buildable ideas for the same page.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/35 (merged as 1ea196f) — reconciled with IDEA-007: `/tracks` is the directory, `/tracks/[slug]` is this template-rendered detail page. Template placeholders: `{{name}}`, `{{description}}`, `{{leaders}}`, `{{repositories}}`, `{{artifact_links}}` (flat substitution, no loop syntax, rendered via markdown-it).

Task: https://github.com/constructorfabric/fabric-pass/issues/34

By: vzhuman · 2026-08-06

## [DONE] [vzhuman] IDEA-036 — Admin contributor list: status/completeness filters, disabled-state buttons, tile layout
Idea:
A follow-up to IDEA-012's Admin contributor list (DONE): a status filter (so an Admin can filter out already-`confirmed` contributors), a completeness column (IDEA-034) with its own filter, Confirm/Block buttons that grey out once already in that state instead of staying clickable, and replacing the current wide, horizontally-scrolling table with tiles that fit the screen width.

Expected outcome:
- A filter for contributor status, at minimum a way to exclude already-`confirmed` contributors from the list.
- A completeness column (IDEA-034) shown per contributor, with its own filter.
- Confirm is disabled when a contributor is already `confirmed`; Block is disabled when already `blocked` — each button stays clickable only when pressing it would actually change something.
- The table (today requiring horizontal scroll — see globals.css's `.admin-table-wrapper`) is replaced by tiles that fit the screen width without horizontal scrolling.

Notes:
Follow-up to IDEA-012 rather than an edit to it, since IDEA-012 is DONE.
Depends on IDEA-034 (profile completeness) for the completeness column/filter specifically — the rest (status filter, disabled buttons, tile layout) doesn't depend on it and could ship first if IDEA-034 isn't ready yet.
Four changes bundled into one idea rather than split, since they're all the same page's UX and land together naturally as one pass over `admin-contributor-table.tsx` — flag if a split into smaller ideas is actually wanted before implementation.
Tile content (which fields show on a tile vs. only on click-through, if any) isn't specified — needs a quick design pass before implementation.
Shipped alongside IDEA-034 in the same PR, since the completeness column/filter depends on it directly.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/25 (merged as 05c999d)

Task: https://github.com/constructorfabric/fabric-pass/issues/24

By: vzhuman · 2026-08-06

## [DONE] [vzhuman] IDEA-037 — Admin tiles: full-width single column, Full Name as primary identifier, labelled icons
Idea:
A follow-up to IDEA-036's Admin tiles (DONE): one tile per row instead of a multi-column grid, Full Name promoted to the visually primary identifier with everything else (GitHub, Email, Company, Discord) shown as icon-labelled secondary properties, the status and completeness badges each carrying a distinguishing icon so they're not mistaken for one another, and Confirm/Block restyled as primary/secondary buttons (reusing the profile form's own `.button-primary`/`.button-secondary`).

Expected outcome:
- `.admin-tiles` is a single column at any width — no multi-tile grid row.
- A tile's Full Name renders larger/bolder than everything else on it; falls back to `@login` when no name is set, so the primary identifier is never blank.
- GitHub, Email, Company, and Discord (new — not shown on the tile before this) each render with their own icon instead of a text label, flowing in a compact wrapped row.
- The status badge (admin-set) and completeness badge (derived) each carry a distinct icon, with a title hint spelling out which is which.
- Confirm is `.button-primary`, Block is `.button-secondary`; both already disabled once the row is already in that state (IDEA-036), now with an actually greyed-out look via a `:disabled` opacity rule.
- Filter dropdowns' default option reads "Status"/"Completeness" instead of "Every status"/"Every completeness".

Notes:
Purely a UI pass over IDEA-036's own tiles — no data model or server-action change, aside from adding `discordUsername` to the row already fetched by `listContributorsForRegistry`.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/27 (merged as e97a3ed)

Task: https://github.com/constructorfabric/fabric-pass/issues/26

By: vzhuman · 2026-08-07

## [DONE] [vzhuman] IDEA-038 — Profile & public profile polish: consistent badges, Cancel→Close, inline email confirmation, public profile icons and Close button
Idea:
Six polish items across the signed-in Profile page/form and the public profile page: consistent capitalization for the status/completeness badges wherever shown; the same badge+icon format used everywhere a contributor's status or completeness appears; the Profile edit form's Cancel button renamed to Close; the Email field's always-clickable Confirm/Re-confirm button replaced with a static Confirmed/Confirmation-required tag in view mode; a company icon on the public profile page; and a Close button (→ Main) on the public profile page, matching the Profile page's own Edit/Close pair.

Expected outcome:
- Status (`draft`/`confirmed`/`blocked`) and completeness (`Incomplete`/`Ready`/`Complete`) badges use the same capitalization everywhere they're shown — Capitalized, matching completeness's existing `PROFILE_COMPLETENESS_LABELS` (status today renders its raw lowercase DB value with no label map at all).
- The same badge shape (icon + label) is used for status/completeness wherever either appears.
- Profile edit mode's Cancel button reads Close instead.
- Profile view mode's Email field shows a static tag — green "Confirmed" or red "Confirmation required" — instead of today's Confirm/Re-confirm button, which is clickable (and triggers a real resend) even in read-only view mode. Edit mode keeps the actionable button.
- The public profile page shows a company icon before the company name (plain text today).
- The public profile page gets a Close button (X icon, "Close" hint) that navigates to Main.

Notes:
Item 2 is only partially decided: which of status/completeness actually belongs on the search-results list and on the public profile view is open — search only ever returns `confirmed` contributors, so a status badge there is always the same value; whether completeness is even appropriate to show about someone *else's* profile (vs. only your own) needs deciding before implementation.
Item 3's "preferred" option per the request — rename Cancel to Close — is what's recorded above. The alternative, an actual rollback of changes made since entering edit mode, is a materially bigger feature (autosave has already persisted each field individually as it was typed; "rollback" means tracking and reverting every field back to its value on entry) and isn't the default here.
Item 4 only changes Profile *view* mode — edit mode keeps today's actionable Confirm/Re-confirm button, since sending a confirmation email is still something the contributor needs to be able to trigger.
Items 5/6 reuse existing pieces — `CompanyMark`/`CloseMark` (added for IDEA-036/037 and IDEA-001 respectively) and the Profile page's own `icon-button-square` pattern — no new icon design needed.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/49 (merged as ed42ac8) — item 2 resolved as status-only (never completeness) on search results and public profiles.

Task: https://github.com/constructorfabric/fabric-pass/issues/28

By: vzhuman · 2026-08-07

## [DONE] [vzhuman] IDEA-039 — Track leaders shown by GitHub login, not real name
Idea: A track's leaders (`/tracks/[slug]`) resolved a filled leader slot to the contributor's real `name` field when set, showing full real names on a page visible to any signed-in contributor; always show `@github_login` instead, matching how the Admin tiles already fall back.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/38 (merged as 967c517)

Task: https://github.com/constructorfabric/fabric-pass/issues/37

By: vzhuman · 2026-08-08

## [DONE] [vzhuman] IDEA-040 — cf-internal config registry (org/server names, sync mapping)
Idea:
A small `pass/config.yaml` in cf-internal, one-way synced the same way as `tracks.yaml`, holding the values IDEA-041/042 need but that shouldn't be hardcoded: the GitHub organization name and the Discord server (guild) id. Foundational — IDEA-041/042 both depend on it existing first.

Expected outcome:
- `pass/config.yaml` exists in cf-internal with at least `github_organization` and `discord_guild_id`.
- A new singleton table (same pattern as `track_page_template`) holds the synced values, read via a small `lib/app-config.ts`.
- A push to the file syncs it to production the same way `tracks.yaml`/`artifact-links.yaml` already do.

Notes:
Singleton-row table, not per-field env vars — env vars need a droplet SSH session and a redeploy to change; this only needs a commit, matching the "easy to maintain for Track Admins and Org Admins" goal already established for IDEA-032/035.
Depends on nothing existing in this app yet; IDEA-041/042 depend on this.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/54 (merged as 01b440d) — `pass/config.yaml` live in cf-internal with real `github_organization` (constructorfabric) and `discord_invite_url` (the same real link already in the app's footer). `discord_guild_id` left unset — no verified real snowflake id exists yet.

Task: https://github.com/constructorfabric/fabric-pass/issues/51

By: vzhuman · 2026-08-08

## [DONE] [vzhuman] IDEA-041 — Auto-invite a confirmed contributor to the GitHub org and Discord server
Idea:
When an Org Admin confirms a contributor (IDEA-012's Confirm button), automatically send them a GitHub organization invite and a Discord server invite, instead of that being a manual follow-up outside the app. A "Re-invite" action is available once a reasonable amount of time has passed since the last invite, for the case where the first one didn't land.

Expected outcome:
- Confirming a contributor triggers a GitHub org invite (`PUT /orgs/{org}/memberships/{username}`) and a Discord invite, best-effort — a failure here must never roll back or block the Confirm action itself, the same "never block the caller's own action" discipline `sendConfirmationEmail` already follows.
- The Admin contributor list shows, per confirmed contributor, whether an invite was sent and when.
- A "Re-invite" button appears once the last invite is older than a cooldown window, to resend without spamming GitHub/Discord's invite endpoints on repeated clicks.

Notes:
Two real technical constraints, not implementation details — need your call before this can move to TODO:
1. **GitHub**: `PUT /orgs/{org}/memberships/{username}` needs a token with `admin:org` (or an org-installed GitHub App with the Members org permission) — a materially higher-privilege credential than `CF_INTERNAL_PAT` (repo-content-scoped only). This has to be a fresh token you mint, not something this app or I can generate.
2. **Discord**: there is no API that silently drops an arbitrary user into a guild — Discord requires either (a) the user to click a normal invite link (`discord.gg/...`) and accept it themselves, or (b) a prior `guilds.join`-scoped OAuth consent from that specific user plus an access token from that consent, which this app doesn't currently request (today's Discord sign-in asks only for `identify`) or store (no provider access token is persisted after login at all, for any provider). Option (a) is achievable now; option (b) would mean re-authenticating every existing Discord-linked contributor with a wider scope and starting to persist a normally-discarded token — a much bigger change. Recommend (a) for a first version: a real, working Discord invite link, sent automatically, that still needs one click to accept — "automatically invited" rather than "automatically joined." Flagging rather than deciding, since it's a visible behavior difference from what was asked.
Re-invite cooldown: recommend 15 minutes over the suggested 5 — GitHub/Discord's invite endpoints carry secondary rate limits that a 5-minute window makes easier to trip on a busy confirm day, and email/invite delivery itself can lag a few minutes, so 5 minutes mostly just invites double-sends without helping. Open for you to set otherwise.
Needs a new `admin:org`-scoped GitHub token and a Discord bot token (with `Create Instant Invite` permission in the target guild) as new deploy secrets — provisioning both is on you; I can wire up the app-side once they exist.
Depends on IDEA-040 for the org/guild identity this targets.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/54 (merged as 01b440d) — gated behind new optional `GITHUB_ORG_TOKEN` (unprovisioned — GitHub org invite correctly no-ops and logs why, verified live). Discord "invite" ships as a real invite-link email (no bot token needed for this half — see IDEA-042 for where the bot token is actually needed).

Task: https://github.com/constructorfabric/fabric-pass/issues/52

By: vzhuman · 2026-08-08

## [DONE] [vzhuman] IDEA-042 — Auto-add an approved track member to that track's GitHub team and Discord role
Idea:
When a Track Admin accepts a join request (IDEA-013/014), automatically add the contributor to that track's GitHub team and Discord role, so track membership actually grants the repository/channel access it's supposed to — rather than that access being a separate manual step. The track-to-team and track-to-role mapping lives in `pass/tracks.yaml`, alongside the rest of each track's data. A "Re-invite"/"Re-add" action mirrors IDEA-041's, for a Track Admin rather than an Org Admin.

Expected outcome:
- Each track entry in `pass/tracks.yaml` gains optional `github_team` (a team slug) and `discord_role_id` fields.
- Accepting a join request (IDEA-014) adds the contributor to that GitHub team (`PUT /orgs/{org}/teams/{team_slug}/memberships/{username}`) and grants the Discord role (`PUT /guilds/{guild}/members/{user}/roles/{role}`) — both best-effort, same never-block-the-decision discipline as IDEA-041.
- IDEA-014's member list shows, per member, whether team/role assignment succeeded, with a Track-Admin-facing retry action once a cooldown has passed.

Notes:
Discord role assignment additionally requires the contributor to already be a guild member — which, per IDEA-041, only happens once they've clicked that invite link. A join-request accepted before the contributor has actually joined the Discord server can only add the GitHub team immediately; the Discord role assignment needs to either wait or be retried later. Worth deciding: silently skip and let the Re-add button cover it, or surface that specific "not in the server yet" state distinctly from a real failure.
Reuses IDEA-041's GitHub org token (team membership needs the same `admin:org`-level privilege, or org-admin/team-maintainer permission over that specific team) and Discord bot token (role assignment needs `Manage Roles`, with the bot's own role positioned above every role it's asked to grant in the guild's role hierarchy) — no new credentials beyond what IDEA-041 already needs.
Depends on IDEA-013/014 (the join-request/acceptance this hooks into), IDEA-040 (org/guild identity), and IDEA-041 (the GitHub/Discord credentials and invite mechanism this extends from org-level to per-track).

Result: PR https://github.com/constructorfabric/fabric-pass/pull/54 (merged as 01b440d) — gated behind new optional `GITHUB_ORG_TOKEN`/`DISCORD_BOT_TOKEN` (neither provisioned — both correctly no-op and log why, verified live: GitHub team-add attempted with the real team slug; Discord role grant correctly skipped for a contributor with no linked Discord account, by design). `github_team`/`discord_role_id` are new optional per-track fields on `pass/tracks.yaml` — none of the real tracks have them set yet, no fabricated team slugs or role ids.

Task: https://github.com/constructorfabric/fabric-pass/issues/53

By: vzhuman · 2026-08-08

## [DONE] [vzhuman] IDEA-043 — Fix a brief production outage from two concurrent deploy webhook calls
Idea: PR #46 and PR #38 were merged ~3 seconds apart, firing two overlapping "Build and deploy" runs; their deploy-webhook calls raced on the same droplet, corrupting an image-layer extraction (`failed to Lchown ... no such file or directory`) and leaving `fabric-pass-app-1` stuck half-removed — production served 502 until fixed.

Result: removed the stuck container and force-recreated `app` (`docker compose up -d --force-recreate app`) — confirmed `/` and `/tracks` back to 200, migration 015 applied, all four containers healthy. Self-inflicted (merged two PRs back-to-back without waiting for the first deploy to finish) and caught within minutes, not an independent discovery. Going forward: verify one PR's deploy has actually landed (not just that the GitHub Actions run reports success — that only covers build+push+webhook-call, not the droplet's own `docker compose up`) before merging the next.

By: vzhuman · 2026-08-08

## [DONE] [vzhuman] IDEA-044 — Deploy webhook: verify GitHub's signature and source IP
Idea:
The deploy webhook authenticates a plain bearer token sent by `curl` from an Actions runner. Now that this repo is public — endpoint, auth scheme and `server.mjs` all readable — replace that with a webhook GitHub itself delivers, whose `X-Hub-Signature-256` is verified and whose source IP is checked against GitHub's published hook ranges.

Expected outcome:
- `.github/workflows/deploy.yml` no longer calls the droplet at all; GitHub delivers a `workflow_run` webhook once "Build and deploy" completes.
- The webhook verifies `X-Hub-Signature-256` (HMAC-SHA256 over the raw request body) with a timing-safe comparison, and rejects anything that doesn't match.
- Requests arriving from outside GitHub's published `hooks` CIDR ranges are rejected.
- A delivery whose `workflow_run.conclusion` isn't `success`, or whose branch isn't `main`, never triggers a deploy.

Notes:
The real gain is that the shared secret stops travelling over the wire: today's bearer token is transmitted in full on every deploy, whereas an HMAC signature proves possession without sending it. Brute-force resistance is *not* the gain — `DEPLOY_WEBHOOK_SECRET` is already 64 hex chars (256-bit).
IP allowlisting is only worth doing on this design. GitHub's `hooks` list is 6 stable CIDR ranges; the `actions` list is 7,297 and is shared by every GitHub-hosted runner on earth, so allowlisting *that* would be close to meaningless as a boundary.
Caddy proxies this endpoint, so the observed source IP has to come from `X-Forwarded-For` — which is client-spoofable unless Caddy is told to overwrite rather than append it. Getting this wrong turns the allowlist into a bypass, so `trusted_proxies` has to be set explicitly; the IP check is defence-in-depth behind the signature, never the primary control.
Webhook delivery is at-least-once — GitHub retries, so duplicate deliveries are routine rather than exceptional. The webhook still has no concurrency guard, which makes IDEA-045 more pressing under this design, not less.
Creating the webhook in repo settings (URL, secret, event) is an owner action; this repo's code can't do it.

Result: PRs https://github.com/constructorfabric/fabric-pass/pull/58 (merged as 23dab7c) and https://github.com/constructorfabric/fabric-pass/pull/59 (merged as d22d76e). Verified live end to end: two real `workflow_run` deliveries passed the IP allowlist, the signature check and the event gate, and redeployed `app` — `deploying d22d76e… (run 31369715149)` in the webhook log, with `/`, `/tracks` and `/policies` all 200 afterwards.
The webhook is registered at the **organization** level, not on the repo, so `GET /repos/.../hooks` reports none — worth knowing before concluding it's missing.
#59 fixed a bug that would otherwise have silently killed every deploy: the origin is behind Cloudflare, so the address Caddy observes is a Cloudflare edge and the rightmost `X-Forwarded-For` entry is too. The first cut read those, and would have rejected every genuine delivery with a 403. It reads `CF-Connecting-IP` instead. Confirmed live that Cloudflare overwrites a client-supplied `CF-Connecting-IP` at the edge: a forged one came back 403 (rejected on the real address) rather than 401, which is what it would have returned had the forgery reached the signature check.
Found only by testing against the real public URL — the ten-case local matrix in #58 passed because nothing fronts `localhost`.

Task: https://github.com/constructorfabric/fabric-pass/issues/56

By: vzhuman · 2026-08-08

## [DONE] [vzhuman] IDEA-045 — Serialize deploys in the webhook instead of by hand
Idea: IDEA-043's overlapping-deploy outage was closed with a human process ("verify one deploy landed before merging the next"), not code — `server.mjs` still starts a `docker compose pull` per request with no mutex. Guard it with an in-flight flag that coalesces (at most one queued follow-up, not one per request), so concurrent merges and GitHub's at-least-once webhook retries can't race the same droplet again.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/60 (merged as ec394ce). Verified live under the real failure shape rather than a simulated one — the #60 merge run and a manual dispatch delivered close enough together that the second landed mid-deploy, and the webhook log shows `deploy already in flight — coalescing into a single follow-up run` followed by two `deployed:` lines: one original plus one coalesced follow-up, where IDEA-043 had two racing pulls. `/`, `/tracks` and `/policies` all 200 afterwards.
Coalescing rather than queueing, because every deploy pulls the same `:latest` — N deliveries mid-deploy need one follow-up, not N.
Each `docker` step is also bounded. `done()` is what releases the lock, so a hanging pull would leave the runner permanently busy and silently stop every future deploy — worse than the race being prevented. Slight scope addition over this idea's literal text, included because the mutex isn't correct without it.
The in-memory flag is only sufficient because the webhook is one Node process in one container; scaling it to more than one replica would need a real lock and would otherwise silently stop being a guard (noted in serialize.mjs's module doc).

Task: https://github.com/constructorfabric/fabric-pass/issues/57

By: vzhuman · 2026-08-08

## [DONE] [vzhuman] IDEA-046 — Home page as tiles: Vision, Policies, Tracks, People
Idea:
Redesign Main into a "Home" page: a title reading "Home", and a set of clickable tiles — Vision, Policies, Tracks, People — each showing a small stat and linking to a dedicated page. IDEA-015's onboarding checklist sits above the tile grid for as long as it has anything to show.

Expected outcome:
- Main's heading reads "Home".
- Four tiles: Vision (last updated), Policies (last updated), Tracks (count of tracks), People (count of confirmed contributors).
- Vision tile → a new page (`/vision`) listing community-wide `vision`-category artifact links, same shape as the existing `/policies` page (IDEA-006).
- Policies tile → the existing `/policies` page, unchanged.
- Tracks tile → the existing `/tracks` directory (IDEA-007).
- People tile → a new page (`/contributors`, symmetric with the existing `/contributors/[hash]` public profile route) hosting contributor search (IDEA-005). Main's inline search moves there entirely — Main has no inline search after this ships.
- The onboarding checklist renders above the tile grid, same visibility rule as today (refined further by IDEA-047).

Notes:
"Vision" already exists as an artifact-link category (IDEA-032, `category: 'vision'`) — no new registry needed, only a new page reading it.
"Last updated" for Vision/Policies: today's sync is full-replace (delete-all + insert on every cf-internal push — migrations/013's own doc), so `updated_at` reflects "last time this file was synced," not a true per-document edit date. Stated plainly in the UI rather than implying more precision than the data supports.
Depends on IDEA-005 (search), IDEA-006 (policies), IDEA-007 (tracks directory), IDEA-032 (artifact links).

Result: PR https://github.com/constructorfabric/fabric-pass/pull/64 (merged as 9156f40). Live-verified in a browser against seeded data before merge — every tile clicked through, every zero-state checked, search confirmed still round-tripping from its new `/contributors` home — then confirmed in production: `/`, `/vision`, `/policies`, `/tracks`, `/contributors` all 200 after the automatic IDEA-044/045 webhook deploy.

Task: https://github.com/constructorfabric/fabric-pass/issues/62

By: vzhuman · 2026-08-10

## [DONE] [vzhuman] IDEA-047 — Onboarding checklist: todo/done/hidden states, self-hide, and real policy-read tracking
Idea:
Extends IDEA-015's checklist with a third state, `hidden`, alongside `todo`/`done` — a contributor can hide any item once it's `done` (a small "Hide" control appears only on done items), and the whole checklist disappears once every item is hidden. Also replaces the "Read the community policies" step's always-a-plain-link shape with real completion tracking: done once the contributor has visited Policies and clicked through to at least one policy document, not merely landed on the page.

Expected outcome:
- Each of the three existing steps (complete profile, read policies, join a track) is independently `todo`/`done`/`hidden`, persisted per contributor.
- "Complete profile" reads done once `profile_completeness` is `ready` or `complete` (not `incomplete`).
- "Read policies" reads done once the contributor has clicked through to at least one policy link from the Policies page — tracked via a small internal redirect (`/policies/visit?url=...`) that records the click before forwarding to the real URL, not just visiting the page.
- "Join a track" reads done once `anyMembershipSummary` reports `approved` — the existing single-state signal already backing this step today, reused as-is.
- A done item shows a "Hide" control; clicking it sets that item to `hidden` immediately, no confirmation step.
- The whole checklist section (heading included) stops rendering once every item is `hidden`.

Notes:
Storage: three new nullable columns/states on `contributors`, matching this codebase's established flat-column-per-fixed-signal convention (e.g. `github_org_invited_at`) rather than a generic key-value table — simple for exactly three items, at the cost that a future fourth checklist item needs a fourth column.
Depends on IDEA-015 (the checklist itself) and IDEA-034 (profile completeness values).

Result: PR https://github.com/constructorfabric/fabric-pass/pull/65 (merged as ea1a629). `/policies/visit` validates against the actual registry rather than redirecting blindly — an unrestricted `?url=` param on this app's own trusted domain would have been a real open-redirect vulnerability. Migration backfills the hidden state for whatever was already done under the old completeness-gated panel (verified against real production data post-deploy: every `ready`/`complete` contributor, 45 of 53, correctly starts with "complete profile" pre-hidden — nobody sees the checklist resurface for something they'd already finished). Full interactive loop — click-through tracking, instant hide, whole-panel disappearance surviving a real reload — live-verified in a browser before merge.

Task: https://github.com/constructorfabric/fabric-pass/issues/63

By: vzhuman · 2026-08-10

## [DRAFT] [vzhuman] IDEA-048 — Requestor details on the Track membership review screen
Idea:
IDEA-014's `/tracks/admin` review screen shows a pending or approved member by little more than their GitHub login/name today. A Track Admin deciding on a request has to leave the page (search GitHub, guess at a public profile URL) to learn anything else about who's asking. Show the requester's GitHub account, company, and a link to their public profile directly on each row.

Expected outcome:
- Each row (pending and approved) shows the requester's GitHub login (already shown) plus their company, if set.
- Each row links to the requester's public profile (IDEA-004).

Notes:
`company` isn't in `track-members.ts`'s `SELECT_WITH_CONTRIBUTOR` join today — needs adding, same shape as `github_login`/`name` already being pulled from `contributors`.
The profile-link part has a real edge case worth deciding, not glossing over: `getPublicProfile` (IDEA-004) only ever resolves a `confirmed` contributor — nothing stops a still-`draft` contributor from requesting to join a track (`requestToJoinTrack` has no status gate), so a genuinely public, working profile link won't always exist for every row. Needs a decision: omit the link (plain text company/login only) for a `draft` requester, or something else.
Depends on IDEA-014 (the screen itself) and IDEA-004 (the public profile being linked to).

By: vzhuman · 2026-08-14

## [DRAFT] [vzhuman] IDEA-049 — Track member roles: Contributor and Maintainer, as two separate flows
Idea:
IDEA-014's review screen currently offers a plain binary Accept/Reject on each pending request. Deciding a join request and changing an existing member's standing are two genuinely separate flows, not one three-way choice at decision time:
- Deciding a pending request stays binary — add the requester as a Contributor, or Decline. No Maintainer option here.
- A Track Admin may separately promote an existing Contributor to Maintainer, or demote a Maintainer back to Contributor, at any later time.
Maintainer is a real access grant, not just a label: write access to the track's repositories, entry in a repository's CODEOWNERS for a specific path, and admin rights on selected repositories.

Expected outcome:
- A pending request's only two outcomes are "Add as Contributor" (renames today's Accept/`approved`) and "Decline" (renames today's Reject/`rejected`) — no role choice at this step.
- Every approved member has a role — Contributor or Maintainer — visible on the review screen.
- A Track Admin (or Admin) can promote a Contributor to Maintainer, or demote a Maintainer back to Contributor, from that member's own row.
- Becoming a Maintainer grants: write (push) access to the track's repositories; an entry in a repository's `CODEOWNERS` file for a specific path; admin rights on a selected subset of the track's repositories.

Notes:
Confirmed: a `role` column on `track_members` is the right home for Contributor/Maintainer itself — that table is already fully app-owned (IDEA-013), unlike `track_admins`/the leader slots (both cf-internal-sync-only, no in-app writer for either).
The three GitHub grants above are a materially bigger technical surface than anything this app has done so far, and none of them can be assumed working from IDEA-041/042's existing integration — each is worth calling out plainly rather than folding into "just another API call":
- **Write/admin access** is `PUT /repos/{owner}/{repo}/collaborators/{username}` with `permission: push` or `admin`. This is a *repository*-level grant, not the org/team-level grant IDEA-041/042 already do — `GITHUB_ORG_TOKEN`'s current `admin:org` scope was chosen specifically for org membership and team management and likely isn't sufficient here; repo collaborator management typically needs `repo` scope (classic) or a fine-grained PAT with per-repo/org "Administration" write permission. Needs its own credential check before assuming reuse, the same way IDEA-041 flagged `admin:org` as a new, higher-privilege token at the time.
- **CODEOWNERS** isn't an API permission at all — it's a plain text file (`CODEOWNERS`, usually at a repo's root, `.github/`, or `docs/`) that this app would have to read, parse, edit, and commit back via GitHub's Contents API. That raises real design questions this idea doesn't answer yet: does the app commit straight to the default branch, or open a PR for a human to merge (this codebase's own deploy discipline elsewhere leans toward "never skip review"); how is "specific path" chosen — typed in by the Track Admin at promotion time, or configured per track in advance; and how does an edit degrade gracefully if a repo's CODEOWNERS file doesn't exist yet or is in a format the app doesn't expect.
- **"Selected" repositories** for admin access implies per-Maintainer, per-repository configuration (which of a track's repos does *this* Maintainer administer), not one flag that applies uniformly to every Maintainer on a track — a real data-model question (something closer to a `track_member_repo_grants` join than a single `role` column can express on its own).
This is now sizeable enough that it likely wants splitting into smaller, independently-deliverable ideas before any of it moves to TODO — e.g. "Contributor/Maintainer role + promote/demote UI" (small, no GitHub calls) as one idea, repo write/admin access as a second, CODEOWNERS management as a third (the newest, least-specified, and most different in kind — a content edit, not a permission grant). Flagging the split rather than doing it unilaterally, since the idea is still being actively shaped.
Distinct from IDEA-018 ("Volunteer for an open track leader slot") — that idea is about the five named leader slots (Product Manager/Architect/etc.), which this one deliberately does not touch.
Depends on IDEA-014 (the screen the role/promote-demote flows live on).

By: vzhuman · 2026-08-14

## [DONE] [SysoevAndrey] IDEA-050 — Adopt @gears-frontx/ui-kit: install and audit replaceable UI
Idea: Install `@gears-frontx/ui-kit@0.3.0-alpha.2` and map every place in the app where hand-rolled UI can be replaced by a ui-kit component, producing an adoption plan for follow-up ideas.

Result: Adoption audit published on the task issue — https://github.com/constructorfabric/fabric-pass/issues/69#issuecomment-5283292081 (component-by-component mapping plus suggested slices); the dependency itself landed with IDEA-051 (PR #76).

Task: https://github.com/constructorfabric/fabric-pass/issues/69

By: SysoevAndrey · 2026-08-13

## [DONE] [SysoevAndrey] IDEA-051 — ui-kit foundation: theme.css tokens + client re-export wrappers
Idea: First adoption slice of IDEA-050's plan — land the `@gears-frontx/ui-kit` dependency, import `theme.css` pinned to the app's light theme (`data-theme="light"`), and add a `'use client'` re-export module so server components can render the kit's hook-using components. No visual change yet.

Result: PR https://github.com/constructorfabric/fabric-pass/pull/76 (merged as 4518087). The re-export wrapper also prompted an upstream fix — constructorfabric/gears-frontx#568 — so the kit now ships its own `'use client'` directives as of 0.3.0-alpha.3, making the wrapper removable (IDEA-052).

Task: https://github.com/constructorfabric/fabric-pass/issues/70

By: SysoevAndrey · 2026-08-13

## [TAKEN] [SysoevAndrey] IDEA-052 — Adopt ui-kit across the app in one pass (0.3.0-alpha.3)
Idea:
ui-kit 0.3.0-alpha.3 ships its own `'use client'` directives (constructorfabric/gears-frontx#568), so the app-side re-export wrapper from IDEA-051 is obsolete. Bump to alpha.3, drop the wrapper, and replace all hand-rolled UI mapped by IDEA-050's audit in a single pass — Button, Badge, Card, Field/Input/Label, Select, DropdownMenu — deliberately one atomic switch, so the app never ships half old, half kit.

Expected outcome:
- Every button/action is kit `Button` — no `.button-primary`/`.button-secondary`/`.icon-button-square`/`.link-button` styling left.
- Every status label (`.admin-status`, `.completeness-badge`, onboarding step statuses, droplet boxes, email statuses) is kit `Badge`.
- Admin tiles/panels are kit `Card`; the profile form and search/filter inputs are kit `Field`/`Input`/`Label`; admin filters are kit `Select`; the user menu is kit `DropdownMenu`.
- Dead CSS for the replaced patterns is removed from `globals.css`.

Notes:
Out of scope because the kit has no equivalent (not because migration stops half-way): home link-tiles, post-redirect notice banners, header/footer, search-results list, and the touch-capable `Hint` (kit Tooltip is disabled on touch by design — replacing Hint would regress #68). Toast stays out too — swapping inline errors for toasts is a UX change, its own idea.

Task: https://github.com/constructorfabric/fabric-pass/issues/77

By: SysoevAndrey · 2026-08-14

## [DONE] [vzhuman] IDEA-053 — Default GitHub team on contributor org invites, via global config
Idea: IDEA-041's org invite (`inviteToGitHubOrg`) adds a confirmed contributor to the GitHub org but not to any team — every invited contributor should land in a configurable default "Contributors" team automatically. Configured once, org-wide, via the same `pass/config.yaml` mechanism IDEA-040 already syncs `github_organization` and the Discord fields from.

Expected outcome:
- `pass/config.yaml` gains an optional `github_contributors_team` field (a team slug), synced to `app_config` the same one-way way as the other fields there.
- `inviteConfirmedContributor` (lib/invites.ts) also adds the contributor to that team whenever the config value is set, right after the org invite itself succeeds — reusing `addToGitHubTeam` (github-org.ts, already built for IDEA-042) as-is, no new GitHub API integration.
- The existing Re-invite button also re-attempts the team add, the same way it already re-attempts the org invite.

Notes:
Named `github_contributors_team`, not `github_default_team` — reads unambiguously next to the per-track `github_team` field IDEA-042 already put on `pass/tracks.yaml`: this one is org-wide, that one is per-track.
`PUT /orgs/{org}/teams/{team_slug}/memberships/{username}` (what `addToGitHubTeam` already calls) works on a pending invitee, not just a full member, per GitHub's own docs — worth a live sanity check once real credentials exist, the same caveat every `GITHUB_ORG_TOKEN`-gated call in this app already carries and none has yet been checked against a real token.
Depends on IDEA-040 (the config sync mechanism this extends) and IDEA-041/042 (the invite flow and the `addToGitHubTeam` call this reuses).
Deliberately left out of this pass: surfacing `githubContributorsTeamAddedAt` on the admin table, and folding it into the Re-invite cooldown calc — `admin-contributor-table.tsx` was under active migration to `@gears-frontx/ui-kit` (IDEA-052) while this shipped, so the change avoided touching that file. Cheap follow-up once that migration lands.

Result: PR #80 — merged, migration `023_contributors_team_config.sql` applied and verified in production, `pass/config.yaml`'s `github_contributors_team: contributors` synced and confirmed present in production's `app_config` table.

Task: https://github.com/constructorfabric/fabric-pass/issues/81
By: vzhuman · 2026-08-15

## [TAKEN] [vzhuman] IDEA-054 — Reconciliation report: org members/invitees missing from the default team
Idea: A read-only Admin report for IDEA-053's default Contributors team — every GitHub org member and every pending org invitation that is *not* currently in that team, so an Admin can find and fix drift: people who joined before the default team existed, or joined the org some other way outside this app entirely.

Expected outcome:
- A new Admin-only page listing every org member and every pending invitation not currently a member of the configured Contributors team.
- Read-only for a first version — surfaces the gap; see Notes on whether fixing it in the same click belongs here or as a follow-up.

Notes:
Needs no new GitHub credential: `GET /orgs/{org}/members`, `GET /orgs/{org}/invitations`, and `GET /orgs/{org}/teams/{team_slug}/members` are all covered by the same `admin:org`-scoped `GITHUB_ORG_TOKEN` this app already holds for IDEA-041/042's writes — reading is a strictly smaller ask than what the token already does.
GitHub paginates all three list endpoints (100 rows/page) — a real org needs actual pagination handling, not one unpaginated fetch, once membership is more than a page.
Open question: report-only, or a one-click "add to team" action per row too? Read-only is the smaller, safer first cut; a fix-in-place action is a natural, cheap follow-up once the report itself is trustworthy.
Depends on IDEA-053 — nothing to reconcile against until the default team is actually configured.

Task: https://github.com/constructorfabric/fabric-pass/issues/82
By: vzhuman · 2026-08-15

## [DONE] [vzhuman] IDEA-055 — Track leader roles: support up to 3 people per role, linked to their public profile
Idea: Each of a track's five named leader roles (Product Manager, Architect, Developer, Quality, Researcher — IDEA-010) currently holds exactly one person, stored as one `*_github_id` column per role. A track can genuinely have more than one person in the same role (most visibly once Gears/Gears BSS/Gears OSS merge into a single track — see IDEA-056), so each role needs to hold up to 3 people. While reworking how leaders are stored and rendered, also link each leader's GitHub login to their public profile page (`/contributors/{hash}`) — today's track page shows a plain `@login` with no link at all.

Expected outcome:
- A track's leader roles are backed by a `track_leaders` junction table (`track_id`, `role`, `github_id`) — the same many-to-many shape `track_admins` already uses — replacing the five single-value `*_github_id` columns on `tracks`.
- `pass/tracks.yaml`'s `leaders` map takes a list of up to 3 GitHub logins per role instead of one.
- The track page's Leaders section shows one line per leader (`**Role:** [@login](/contributors/{hash})`), each linking to that person's existing public profile page.
- Up to 3 is an app-level cap enforced at sync time (a role with more than 3 logins in the file is rejected, same treatment as an unresolvable login), not a database constraint — cheap to change later.

Notes:
Depends on IDEA-010 (the leader-slot concept this replaces the storage of) and IDEA-039 (GitHub login as the leader's display identity, which this keeps).
Feeds directly into IDEA-056 — the Gears/Gears BSS/Gears OSS merge needs this to preserve every existing leader (product_manager and developer each already have 2 different people across the three source tracks today).

Result: PR #83 — merged, migration `024_track_leaders.sql` applied and verified in production; confirmed every existing leader (Studio, Insight, Gears, Gears BSS, Gears OSS, Research) survived the backfill intact.

Task: https://github.com/constructorfabric/fabric-pass/issues/85
By: vzhuman · 2026-08-18

## [DONE] [vzhuman] IDEA-056 — Merge Gears, Gears BSS, and Gears OSS into a single Gears track
Idea: `pass/tracks.yaml` currently lists Gears, Gears BSS, and Gears OSS as three separate tracks. They merge into one "Gears" track — combining their leaders (via IDEA-055's multi-leader support) and admins, replacing Gears' current large repository list with just its core repositories (gears-rust, gears-csharp, gears-mobile, DNA), and curating the track page's Vision/Roadmap/Documentation content.

Expected outcome:
- `pass/tracks.yaml` has one `gears` entry (no `gears-bss`/`gears-oss` entries), with every leader and admin from all three source tracks carried over, and its repository list trimmed to gears-rust, gears-csharp, gears-mobile, and DNA.
- The track page's artifact-links section renders as separate subsections grouped by category (Vision, Roadmap, Documentation, etc. — using each category's existing label) instead of one flat "Links" list — a shared-template rendering change (`track-page-template.ts`/`pass/track-page.md`) that applies to every track's page, not just Gears'. The `guide` category's label changes from "Guide" to "Documentation" to match.
- Gears' Vision subsection lists the Gears BSS and Gears OSS vision documents (both still-relevant source docs); its Documentation subsection lists the Gears (Rust) web docs and the Gears Quality Framework; its Roadmap subsection links the Gears roadmap project board.

Notes:
Depends on IDEA-055 (multi-leader storage) — without it, merging loses leaders when two source tracks share a role.
The stale `gears-bss`/`gears-oss` track rows aren't deleted automatically by the sync (`syncTracks` only ever upserts, matching its "file adds/updates, never deletes" design used everywhere else in this app) — they're removed from production by a one-off manual cleanup once the merged file has synced, after confirming no approved membership or other real data depends on them.
One admin login from the source tracks (`perfguru87`) never resolved on this or any prior sync — no contributor row with that GitHub login has ever signed in. Pre-existing, not introduced by this merge; the other 4 admins (MikeFalcon77, nonameffh, diffora, entropyshift) synced correctly.

Result: PR #84 (app-side grouped-links rendering, merged and verified in production) + cf-internal commit f22a0c7 (merged `pass/tracks.yaml`/`pass/artifact-links.yaml`/`pass/track-page.md`, synced and verified). Stale `gears-bss`/`gears-oss` rows manually removed from production after confirming only harmless pending join requests depended on them — production now lists exactly 5 tracks (Gears, Governance, Insight, Research, Studio).

Task: https://github.com/constructorfabric/fabric-pass/issues/86
By: vzhuman · 2026-08-18

## [DONE] [vzhuman] IDEA-057 — Gears track page: fix section order, item order, add Andreev as Architect, repositories as a table
Idea: Four fixes to IDEA-056's Gears track page: section order didn't match what was specified (Vision/Roadmap/Repositories/Documentation/Leaders); items within a section (e.g. Documentation) rendered alphabetically instead of in the order given; Alexander Andreev (`Artifizer`) is missing as a third Architect; and Repositories should show the repository name plus its description, as a table, rather than description-only bullet links.

Expected outcome:
- The track page template renders sections in whatever order `pass/track-page.md` places them — each artifact-link category gets its own placeholder (`{{links_vision}}`, `{{links_roadmap}}`, `{{links_guide}}`, ...) instead of one bundled `{{artifact_links}}` blob, so a category no longer has to sit wherever the fixed category-enum order put it.
- `artifact_links` gains a `position` column, stamped as each link's index in `pass/artifact-links.yaml` at sync time — `listArtifactLinks` (used by track pages, /vision, /policies) returns rows in that file order, not alphabetically by label.
- `Artifizer` (Alexander Andreev) is added as a third Architect on the Gears track, alongside `nonameffh`.
- The Repositories section renders as a two-column markdown table (Repository — name derived from the URL, linked, with an issues link folded in when present — and Description), not a bulleted list of description-only links.

Notes:
Directly fixes discrepancies found in IDEA-056's shipped result, plus one straightforward addition — recorded as its own idea rather than reopening a `DONE` one.
`Artifizer`'s GitHub name field is just "Artifizer" (no real name set) — an org-member name search for "Alex Andreev" found nothing; the user supplied the login directly.

Result: PR #87 — merged, migration `025_artifact_links_position.sql` applied and verified in production; cf-internal commit 2ed0328 (`pass/track-page.md` reordered, `Artifizer` added as Gears' third Architect) synced and verified — Gears now has 3 architects, template sections render Vision → Roadmap → Repositories → Documentation → Leaders.

Task: https://github.com/constructorfabric/fabric-pass/issues/88
By: vzhuman · 2026-08-18

## [DONE] [vzhuman] IDEA-058 — Consistent, actionable re-auth prompts when the session is gone mid-action
Idea: Diagnosed a real support case (grigoriy.gogin@constructor.tech clicked "Confirm" on his email but no confirmation email was ever sent) to a missing-session redirect that shows a misleading "That sign-in link has expired" banner instead of clearly asking for GitHub re-auth. The same wrong wording, and the same missing "sign in again" affordance, exist in several other places that check `session.github` mid-action.

Expected outcome:
- `/auth/resend-confirmation` and the Discord/Telegram/LinkedIn callback's "session lost mid-link" branch redirect with a new, correctly-worded `sign-in-required` notice instead of reusing `expired` (which is specifically about a stale/replayed OAuth link, not a missing session).
- Every fetch-based server action that currently returns a plain "Please sign in with GitHub first." with no way to act on it (`saveField`, admin Confirm/Block/Re-invite, Track Admin Accept/Reject/Re-add, Request to join) now also sets `reauthRequired: true`, and every one of their client components shows a "Sign in again" link right next to the error — the same escape hatch `saveField`'s own `ContributorNotFoundError` path already had, extended to the plain "no session at all" case, and to every other action that shares this gap.
- The "session present but the row it names is gone" branches in the Track Admin and Request-to-join actions switch from the generic "Please sign in with GitHub first." to the existing `REAUTH_REQUIRED_MESSAGE`, matching `saveField`'s own precedent for that distinct case.

Notes:
Deliberately not touched: `admin/actions.ts`'s combined `!caller || !isAdmin(caller)` → "Not authorized." check (conflating "session outlived its row" with "genuinely not an admin" isn't this idea's problem to fix, and separating them changes behavior beyond what was asked) and `hideChecklistItemAction` (silently doing nothing when signed out is low-stakes for a "Hide" button, unlike a "Confirm" that silently drops an email).
No new session mechanism needed — iron-session's existing 5-day cookie (session.ts) already works correctly; the gap was entirely in what the UI told people once it noticed the cookie was gone.

Result: PR #89 — merged and verified in production (`curl https://pass.cfabric.org/profile?notice=sign-in-required` renders "Your session has ended. Please sign in with GitHub again."). Grigoriy can now sign in again and click Confirm to actually trigger the send.

Task: https://github.com/constructorfabric/fabric-pass/issues/90
By: vzhuman · 2026-08-19

## [TAKEN] [vzhuman] IDEA-059 — Fix GitHub sign-in: "Linking github did not complete" for every user
Idea: A user reported every GitHub sign-in failing with "Linking github did not complete. Please try again." right after logging out and trying to sign back in. Production logs show the real cause: GitHub's OAuth callback started including an `iss` (RFC 9207 issuer identification) query parameter set to `https://github.com/login/oauth`, and `openid-client`'s underlying `oauth4webapi` rejects the whole callback whenever a present `iss` doesn't exactly equal this app's configured `issuer` — which was the bare origin `https://github.com`, not the path GitHub actually sends. This broke every GitHub sign-in and re-sign-in in production, not just this one user's.

Expected outcome:
- `lib/providers/github.ts`'s configured `issuer` matches what GitHub actually sends (`https://github.com/login/oauth`), confirmed directly against real production callback logs, not guessed from external docs.
- A regression test pins the exact issuer value so an accidental revert fails immediately rather than only in production.

Notes:
`authorization_endpoint`/`token_endpoint` are both given as explicit absolute URLs in the same config, independent of `issuer` — so this fix is narrowly scoped to the one value `oauth4webapi` actually compares against the `iss` parameter, nothing else changes behavior.
Discord's provider config (`lib/providers/discord.ts`) has the same manual-issuer shape (`issuer: 'https://discord.com'`) and could in principle hit the same class of bug if Discord ever starts sending a mismatched `iss` too — not touched here since there's no evidence it's currently broken; flagged for awareness, not fixed preemptively.

By: vzhuman · 2026-08-20

## [DONE] [vzhuman] IDEA-060 — Track join approval: auto-create/join GitHub team, invite to org first if needed; per-track GitHub team names driven by a global pattern
Idea: IDEA-042 already grants a track's GitHub team and Discord role when a Track Admin approves a join request, but two real gaps remain: the GitHub team must already exist and the contributor must already be an org member, or the grant silently fails. Approving a track join should now (1) create the track's GitHub team if it doesn't exist yet, (2) invite the contributor to the org first (reusing IDEA-041/053's existing invite-plus-default-team flow) if they haven't been invited yet, then (3) add them to the team. Also replaces the per-track `github_team` field (manually typed into `pass/tracks.yaml`, unused in the real file today) with a single global naming pattern, so every track's team follows the same `<slug>-contributors` convention without hand-authoring each one.

Expected outcome:
- New `github_track_team_pattern` field in `pass/config.yaml` (e.g. `{track}-contributors`) — the per-track GitHub team slug is computed from this pattern and the track's own slug at grant time, not read from a stored per-track field.
- `tracks.githubTeam`/`pass/tracks.yaml`'s `github_team` are removed — nothing in the real file sets it today, and a global pattern makes a per-track override redundant.
- Approving a join request: if the computed team doesn't exist in the org yet, create it; if the contributor hasn't been invited to the org yet (`githubOrgInvitedAt` unset), invite them and add them to the default contributors team first (reusing `inviteConfirmedContributor`, IDEA-041/053) before adding them to the track team.
- `discord_role_id` per track (already-existing IDEA-042 field, just never populated with real values) gets the real role ids for Studio, Insight, Gears, Research, and Governance, and `discord_guild_id` (already-existing IDEA-040 field) gets the real guild id — both in cf-internal, not new schema.

Notes:
One-time operational follow-up, not an ongoing feature: back-fill every current track admin into that track's Discord moderator role (`mod-<track>`) — a one-off grant against real production data, not something this idea's code does automatically going forward (nothing here grants a moderator role when someone becomes a Track Admin).
Depends on IDEA-040 (`discord_guild_id`)/IDEA-042 (the grant flow and `discord_role_id` this extends) and IDEA-041/053 (`inviteConfirmedContributor`, reused here for "invite to org first").

Result: PR #92 — merged, migration `026_github_track_team_pattern.sql` applied and verified in production; cf-internal commit c5df259 (`discord_guild_id`, `github_track_team_pattern`, per-track `discord_role_id`) synced and verified. One-time moderator backfill executed against production's real Discord API (10 grants: Studio → ainetx/vasylcf, Insight → lobster40, Gears → MikeFalcon77/diffora/entropyshift/nonameffh, Research → sulasen, Governance → frontgeeks/lobster40), all 10 returned 204 and spot-checked against Discord's own member endpoint.

Task: https://github.com/constructorfabric/fabric-pass/issues/93
By: vzhuman · 2026-08-20

## [DONE] [vzhuman] IDEA-061 — Rename Gears to Gears Rust; add Gears FrontX track
Idea: `pass/tracks.yaml`'s `gears` track (repos: gears-rust, gears-csharp, gears-mobile, DNA) renames to "Gears Rust" — slug included, so IDEA-060's global `{track}-contributors` pattern computes `gears-rust-contributors` for it, as requested — and a new "Gears FrontX" track is added, led by `frontgeeks` (Developer) and `GeraBart` (Architect), both also Track Admins, covering the `gears-frontx`/`gears-frontx-templates` repositories.

Expected outcome:
- `tracks.yaml`: `gears` → `slug: gears-rust`, `name: Gears Rust`, otherwise unchanged (same leaders/admins/repos/discord role).
- `artifact-links.yaml`: every `scope: gears` entry becomes `scope: gears-rust` (a track's artifact links are only valid against a real track slug — orphaned otherwise).
- New `gears-frontx` track: leaders `developer: [frontgeeks]`, `architect: [GeraBart]`; admins `[frontgeeks, GeraBart]`; repositories `gears-frontx`, `gears-frontx-templates`; `discord_role_id: "1540174981231808603"`.
- A pending or approved `track_members`/`track_admins` row tied to the real production `gears` track survives the rename — the slug change is applied directly to the existing row in production (matching by the *old* slug) before `tracks.yaml` is pushed, so the file's sync finds the already-renamed row by its new slug and updates it in place, rather than the one-way sync (which never deletes, see IDEA-056) reading a slug change as "new track" and orphaning the old row's real members.

Notes:
No dedicated vision document exists in either `gears-frontx` repository (checked directly — `gears-frontx-templates` is nearly empty, `gears-frontx`'s own `architecture/PRD.md` is a technical requirements doc, not a vision one) — its README's own "The Mission" section is the closest match and is what's linked as the track's Vision artifact.
One-time operational follow-up, same pattern as IDEA-060's mod-role backfill: grant `frontgeeks` and `GeraBart` the `mod-gears-frontx` Discord role (`1540175388414713856`) directly, not through any code path.

Result: cf-internal commit 93f81fc — synced and verified. Production's `gears` row was renamed in place first (`UPDATE tracks SET slug='gears-rust', name='Gears Rust' WHERE slug='gears'`), confirmed its two real approved members (capybutler, striped-zebra-dev) survived; `gears-frontx` track, leaders, admins, and its Vision link all confirmed live. Both `frontgeeks` and `GeraBart` granted `mod-gears-frontx` directly via the Discord API (204, spot-checked against Discord's own member endpoint).

Task: https://github.com/constructorfabric/fabric-pass/issues/94
By: vzhuman · 2026-08-20

## [DONE] [vzhuman] IDEA-062 — Track Admin can remove an approved member
Idea: A Track Admin can currently only decide a pending join request (Accept/Reject, IDEA-014). Once someone is approved, there's no way to undo it — this adds a Remove action on an approved member that revokes the track's GitHub team membership and Discord role (whichever were granted, IDEA-042/060) and records the member as no longer part of the track.

Expected outcome:
- `track_members.status` gains a fourth value, `removed`, distinct from `rejected` — a removed member's history shows they *were* approved and later removed, not that they were declined at the door. A removed contributor can request to join again, same as a rejected one already can.
- A "Remove" button on each approved member's card (`tracks/admin/track-membership-review.tsx`), same Track-Admin/Admin authorization as Accept/Reject/Re-add.
- `lib/github-org.ts`/`lib/discord-role.ts` gain the missing other half of IDEA-060/042's grant calls — `removeFromGitHubTeam`/`revokeDiscordRole` — and `lib/team-access.ts` gains `revokeTrackAccess`, the mirror of `grantTrackAccess`.
- Logged to `admin_actions` (IDEA-022) as a new `remove_from_track` action type, same audit trail as every other Track Admin decision.

Notes:
Part of a 3-idea sequence from one user request — IDEA-062 (this), IDEA-063 (Contributor/Maintainer roles), IDEA-064 (track participation labels on profile views + an avatar rank badge) — planned together, shipped as separate PRs.
Confirmed with the user: a new `removed` status, not reusing `rejected` or deleting the row — preserves that "was approved, then removed" is a different fact than "never accepted."

Result: PR #95 — merged, migration `027_track_member_removal.sql` applied and verified in production. Verified live end-to-end before merge: Remove correctly computed the track's GitHub team slug and attempted both revokes (confirmed via logs), stamped `track_members.status = 'removed'` and the `admin_actions` audit row, and the removed contributor successfully requested to join again ("Removed" badge, not "Declined"). CodeRabbit's two other findings (migration constraint locking, missing fetch timeouts) were reviewed and not applied — the table has ~a dozen production rows so the lock concern doesn't apply, and the timeout gap is pre-existing and codebase-wide, not introduced here (flagged as a separate follow-up task instead).

Task: https://github.com/constructorfabric/fabric-pass/issues/96
By: vzhuman · 2026-08-21

## [TAKEN] [vzhuman] IDEA-063 — Contributor <-> Maintainer roles: promote/demote, a `<track>-maintainers` GitHub team
Idea: `track_members` has no role concept beyond membership status — this gives every approved member a role, Contributor or Maintainer, that a Track Admin can promote/demote between. Promoting grants the track's `<track>-maintainers` GitHub team (a second global pattern, alongside IDEA-060's `<track>-contributors` one), auto-created if it doesn't exist yet, additive to the existing `-contributors` team membership. Demoting removes just the `-maintainers` membership.

Expected outcome:
- `track_members` gains a `role` column (`contributor` default, or `maintainer`), only meaningful once `status = 'approved'`.
- New `github_track_maintainer_team_pattern` in `pass/config.yaml` (e.g. `{track}-maintainers`), parallel to IDEA-060's `github_track_team_pattern`.
- Promote/Demote buttons and a role badge on each approved member's card (`tracks/admin/track-membership-review.tsx`), same Track-Admin/Admin authorization as Remove (IDEA-062).
- Logged to `admin_actions` as `promote_to_maintainer`/`demote_to_contributor`.

Notes:
Second of the 3-idea sequence from IDEA-062's own notes (IDEA-062 remove, this one, IDEA-064 track-participation labels).
This is the concrete build-out of IDEA-049 (drafted 2026-08-14, never implemented) — the user has now specified exactly what Maintainer grants (a GitHub team, nothing about CODEOWNERS or per-repo admin access, which IDEA-049's notes had flagged as open questions). IDEA-049 stays as a draft record of that earlier, broader discussion; this idea supersedes it with the actually-requested, narrower scope.
Depends on IDEA-060 (the `<track>-contributors` team + pattern mechanism this mirrors) and IDEA-062 (the Remove action this UI sits alongside).

Task: https://github.com/constructorfabric/fabric-pass/issues/98
By: vzhuman · 2026-08-21

## [TAKEN] [vzhuman] IDEA-064 — Track participation labels + avatar rank badge
Idea: Nothing on any profile view shows which tracks a contributor actually participates in, or at what rank. This adds a label per track a contributor is approved in (public profile, admin table, private profile), with a rank icon — star for Contributor, triple-star for Maintainer, crown for Track Admin (max rank shown per track) — plus a small rank badge on the one avatar/initials UI in the app (the account-menu trigger in `user-menu.tsx`), showing the single highest rank across every track.

Expected outcome:
- New `listApprovedTrackMemberships(githubId)` and `highestTrackRank(githubId)` in `lib/track-members.ts`.
- New `StarMark`/`TripleStarMark`/`CrownMark` icons in `lib/marks.tsx`, and a shared `app/track-labels.tsx` component rendering one badge per track, used on the public profile, admin contributor table, and private profile (view + edit mode).
- `user-menu.tsx`'s avatar trigger gets a small rank-icon badge at its bottom-right corner, computed server-side in `layout.tsx`.

Notes:
Third of the 3-idea sequence from IDEA-062's own notes (IDEA-062 remove, IDEA-063 promote/demote, this one).
Depends on IDEA-063 (the Contributor/Maintainer role this reads) and IDEA-011/roles.ts's `adminTrackIds` (the Track Admin case, for the crown icon).

By: vzhuman · 2026-08-21
