# Creavate task list

## Phase 0 - Switch discovery

- [x] Confirm project scope and initial clean repository.
- [x] Connect directly to the official docs MCP over HTTP and use its search/read tools.
- [x] Pin and inspect official source, protocol, policies, templates and deployment configuration.
- [x] Write SWITCH_INTEGRATION.md with sources, documentation discrepancies and open questions.
- [x] Keep short decisions and preserve the supplied UI reference for Phase 6.
- [x] Prepare private configuration using the official secret generator; validate Compose configuration.
- [x] Prepare an isolated real-protocol mention probe with scoped, recorded operator approval guards.
- [x] Verify 12 named local unit checks and JavaScript syntax; no live gate inferred.
- [x] Reverify the existing integration report against current docs MCP reads on 2026-11-06.
- [x] Inspect the documented OpenCode/Claude Code session host, MCP tools, skill and credential boundaries.
- [x] Record user decisions: Slack first; OpenCode agents replace the Claude Code preference.
- [x] Record creator-only approval and per-role tool enforcement requirements.
- [x] Compare targeted upstream files with fb5780cf67465f6b9f91d77bcad411b20bde6c2b while preserving the deployment source pin.
- [ ] Verify an exact OpenCode/Core/host version pairing and enforceable per-role tool exposure.
- [x] Make Docker accessible and start the official stack; record real health/readiness and server declaration.
- [x] Receive the Slack workspace URL and export the actual server manifest with a step-by-step setup guide.
- [x] Verify cached direct OpenCode CLIs report 1.19.0 and 2.2.5 without changing the global launcher.
- [x] Build/package the headless host from the same source pin and verify its CLI version.
- [x] Start/stop isolated OpenCode 1.19.0; verify real health and provider inventory without a model call.
- [x] Select the user-approved built-in OpenCode backend and record the model ID from actual inventory.
- [ ] Enroll the controller and verify its model/tool/runtime pairing in the real room.
- [ ] Connect the Slack app, confirm the dedicated channel and verify the creator identity mapping.
- [ ] Run the real custom-agent SSE probe and independently confirm its reply in Slack.
- [ ] Run the real OpenCode-agent room/MCP probe and independently confirm its tool-derived reply in Slack.
- [ ] Record live evidence, pass the Phase 0 gate and commit phase completion.
- [ ] Review live discovery findings; the user separately authorized offline implementation in D021.

**Historical startup:** the isolated Switch stack passed local readiness on 2026-11-06 and was subsequently stopped at the user’s request. Application implementation is now authorized ahead of account connection; both real room probes remain open. No fixture replaces a live-service gate.

The local operator ledger is a protocol-test facility; it does not implement verified creator approvals for sponsorship actions. The application now implements and locally tests wrong-identity approval rejection; its real chat gate is still pending.

A discovery checkpoint may be committed before the live gate; it does not mark Phase 0 complete.

## Application implementation — authorized 2026-11-07

The user requested implementation ahead of account connection, then placed account connection controls in Profile. D021/D023 supersede the earlier Phase 0-only build boundary. No external-service gate is marked passed by this change.

- [x] npm workspaces, TypeScript, lint, unit/database tests, production builds and CI workflow.
- [x] Supabase schema, private credential tables, own-row reads and transactional audit/state storage.
- [x] Strict developer env configuration, private env initialization and publishable-key checks.
- [x] Verified Supabase authentication and single-creator deployment boundary.
- [x] Profile-based Google/Slack OAuth, encrypted tokens, Google refresh and disconnect controls.
- [x] Slack channel pagination, room provisioning and encrypted issued Switch credentials.
- [x] Source-backed Switch HTTP/SSE adapter, heartbeats, persistent cursors and signed handoffs.
- [x] OpenCode provider with isolated config/data, deny-default native tools and role-scoped authenticated MCP.
- [x] Real Gmail ingestion/deduplication, read-only classification tools, PDF/text brief reading and Drive/Calendar functions.
- [x] Immutable approval plans, verified creator decisions, exact provider-parameter checks and exclusive action claims.
- [x] Campaign folder/files/deadlines/tasks, artifact readback and fail-safe uncertain-write handling.
- [x] Task transitions, six-hop cap, per-run tool budgets, duplicate-handoff guard and interrupted-run reporting.
- [x] Reference-inspired dashboard, inbox/deals/approval review, campaign task/deadline controls and live audit feeds.
- [x] Real-account integration/E2E commands with no product fixture fallback.
- [x] README, connection guide, deployment notes and preserved discovery sources.

## Verification and original live gates

- [x] Local unit/security/parser tests; see docs/VERIFICATION.md for the recorded run.
- [x] Local PostgreSQL schema, concurrency, replay, row isolation and role-scoped MCP HTTP checks.
- [ ] Fresh live Supabase migration/Auth/Realtime gate.
- [ ] Custom SSE probe plus OpenCode model/tool reply visible in the real Slack room.
- [ ] All three agents present and a real two-agent room handoff.
- [ ] Every Google tool exercised against the actual test account and logged.
- [ ] A real sponsorship email analyzed and relayed in Slack.
- [ ] Creator-only rejection/approval and approved Google artifacts verified end to end.
- [ ] Dashboard live updates and browser/mobile interaction review.
- [ ] Two fresh-message E2E batches including injection isolation.
- [ ] Commercial Switch licensing/deployment decision before a paid hosted offering.

Tests using the local test auth schema do not establish live Supabase behavior. Model availability, external account permissions, source/host pairing and actual Slack delivery remain unresolved until connected. The historical Phase 0 observations are retained as evidence, not as current service-running status.

## Local dashboard and connection follow-up

- [x] Remove desktop/tablet outer framing so the application fills the viewport.
- [x] Show actual missing workspace prerequisites in Profile and on signed-out pages.
- [x] Prevent protected loads/subscriptions and connection actions before base setup is complete.
- [x] Correct malformed/oversized body responses (400/413), retain denial logs without mislabeling them as server faults, and test real local HTTP responses.
- [x] Remove inherited terminal color conflicts from the local development launcher.
- [ ] Supply real Supabase database/auth and Google/Slack OAuth application settings; sign-in and consent remain blocked until configured.
- [ ] Verify the viewport layout and connection flows in an attached browser and against real accounts.
