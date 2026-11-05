# Creavate task list

## Phase 0 - Switch discovery

- [x] Confirm project scope and initial clean repository.
- [x] Connect directly to the official docs MCP over HTTP and use its search/read tools.
- [x] Pin and inspect official source, protocol, policies, templates and deployment configuration.
- [x] Write SWITCH_INTEGRATION.md with sources, documentation discrepancies and open questions.
- [x] Keep short decisions and preserve the supplied UI reference for Phase 6.
- [x] Prepare private configuration using the official secret generator; validate Compose configuration.
- [x] Prepare an isolated real-protocol mention probe with scoped, recorded approval guards.
- [x] Verify 12 named local unit checks and JavaScript syntax; no live gate inferred.
- [ ] Make Docker accessible to this running account (user selected local Docker; service still inactive).
- [ ] Receive actual Slack workspace URL, workspace/team ID and dedicated test channel details.
- [ ] Install/connect the Slack app using locally stored credentials and link the creator identity.
- [ ] Start the official stack and record real health/readiness and server version/protocol.
- [ ] Record a reviewed Phase 0 approval ID and register one custom agent.
- [ ] Observe a real Slack mention, SSE delivery, heartbeat, history tool return, reply receipt and readback.
- [ ] Independently verify that the reply appears in Slack.
- [ ] Record live evidence, pass the Phase 0 gate and commit the phase completion.
- [ ] Stop for user review and explicit permission to start Phase 1.

A source/discovery checkpoint may be committed before the live gate; it does not mark Phase 0 complete. Never replace the missing live observations with fixtures or simulated outcomes.

## Later phases (all not started)

1. Architecture: npm workspaces, tooling, env validation, CI and Supabase migrations. Gate: CI green plus migrations on a fresh live project.
2. Switch adapter and three creator-owned identities. Gate: real Slack room presence and two-agent message round-trip.
3. Google OAuth, encryption and tool-call logging. Gate: real test-account tools plus database records.
4. Coordination, state machine and hop cap. Gate: real inquiry analysis through Switch.
5. Creator approval and gated writes. Gate: rejection has no effect; approval artifacts read back from Google.
6. Dashboard using the supplied visual reference and live activity. Gate: real-time run with no hardcoded entries.
7. Repeatable E2E validation. Gate: two clean-state real-account runs plus prompt-injection isolation.
