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
- [ ] Make Docker accessible and start the official stack; record real health/readiness and server declaration.
- [ ] Receive Slack workspace/channel details, connect its app and verify the creator identity mapping.
- [ ] Run the real custom-agent SSE probe and independently confirm its reply in Slack.
- [ ] Run the real OpenCode-agent room/MCP probe and independently confirm its tool-derived reply in Slack.
- [ ] Record live evidence, pass the Phase 0 gate and commit phase completion.
- [ ] Stop for user review and explicit permission to start Phase 1.

**User-deferred:** credentials/account and live-connection setup were skipped on 2026-11-06. Continue source and local checks only until live setup is explicitly re-enabled. No fixture replaces a real-service gate.

The local operator ledger is a protocol-test facility; it does not implement verified creator approvals for sponsorship actions. Wrong-identity approval rejection is still required in the application.

A discovery checkpoint may be committed before the live gate; it does not mark Phase 0 complete.

## Later phases (all not started)

1. Architecture: npm workspaces, tooling, env validation, CI and Supabase migrations. Gate: CI green plus migrations on a fresh live project.
2. Switch/OpenCode connection and three creator-owned identities. Gate: real chat-room presence and a two-agent room-message round-trip.
3. Google OAuth, encryption, role-scoped Google MCP tools and tool_calls logging. Gate: real test-account tool calls and their database records.
4. Coordination, state machine and hop cap. Gate: real inquiry analysis handed off through Switch.
5. Verified creator approval and gated writes. Gate: reject agents/other members and wrong deal/action approvals; rejection has no write effect; approved artifacts are read back from Google.
6. Dashboard using the supplied visual reference and live activity. Gate: real-time updates during a run without hardcoded entries.
7. Repeatable E2E validation. Gate: two clean-state real-account runs plus prompt-injection isolation.
