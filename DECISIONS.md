# Decisions

Keep entries short. Proposed items are not approvals.

| ID | Status | Decision |
| --- | --- | --- |
| D001 | Accepted | Public project name is Creavate; CreatorOS describes the requested workflow. Preserve the existing repository name. |
| D002 | Required | Phase 0 only. No monorepo, Supabase migrations, Google integration, LLM host, or dashboard implementation before the live discovery gate and user review. |
| D003 | Proposed | Run the requested SSE compatibility probe, then use HTTP + WebSocket for the production Switch adapter because current official docs deprecate SSE. |
| D004 | Revised | Use the documented OpenCode session-host route if its live gate and tool restrictions pass. Keep protocol details in switch-adapter; custom Node remains an unselected fallback. The private TS runtime is reference code. |
| D005 | Required | Only the creator verified through chat-user/application-user mapping can approve. Reject agents and other room members. Every write tool checks the recorded approval, creator/tenant/deal, exact action, expiry and idempotency; Switch/native permission cards do not replace this guard. |
| D006 | Required | Email/brief content is untrusted data. It cannot supply prompts, tools, permission changes, identities, handoff targets, or approvals. Escape mentions in quoted content. Validate structured outputs and authenticated sender/task envelopes before routing. |
| D007 | Accepted for isolated probe | A disposable local SQLite ledger records operator grants for Phase 0 registration, one connection claim and one reply. The probe requires a recorded approval ID and exact plan digest. It has no Google tools and cannot approve itself from room content. This is not the future Supabase approval implementation. |
| D008 | Required | Google tokens will be encrypted before storage; secrets remain in ignored .env files. Keep raw room/email evidence private. |
| D009 | Accepted | Use the attached dashboard as the Phase 6 visual reference: pale surfaces, purple accents, left navigation, central overview, activity table and right activity rail. All counts, charts and feed entries must come from application data; do not copy example metrics. |
| D010 | Proposed | Use an explicit Slack bridge and creator-owned agent identities. Verify addressing policies; do not broaden to anyone to make handoffs work. |
| D011 | Required | Enforce default 6-hop task cap, transitions and duplicate protection atomically in the application database. Switch delivery receipts are not task completion. |
| D012 | Open | Choose/verify the deployed Core image or source-build pin. Core, Console and controller release numbers are separate. Never float on latest. |
| D013 | Open | Resolve the commercial deployment/licensing model against the upstream modified Commons Clause before committing to a paid hosted offering. |
| D014 | Accepted | Maintain all project work on main. Consolidate the merged discovery branch and create additional branches only when explicitly requested. |
| D015 | Selected | Slack is the first chat platform. Keep platform-specific connection and identity mapping in configuration/adapters so agent behavior can move to Discord or Telegram. |
| D016 | Selected, live pending | Use OpenCode for three separate Switch identities, replacing the Claude Code preference. All handoffs must use Switch room messages. Exact provider/host compatibility and per-role tool enforcement remain unverified. |
| D017 | User-deferred | User skipped credentials/account setup on 2026-11-06. Perform source/local verification only, make no provider calls and do not treat fixtures as live gate evidence. Phase 1 remains unstarted. |

No Google scopes have been requested or granted in Phase 0. The scope decisions remain for Phase 3: gmail.readonly for read-only inquiry access, calendar.events for campaign deadlines, and an explicit choice between Drive file selection/drive.file and the broader access needed for arbitrary brief search. Do not claim drive.file can read/search every existing Drive brief.

Evidence and the protocol/documentation discrepancies are recorded in [SWITCH_INTEGRATION.md](SWITCH_INTEGRATION.md).
