# Verification record

Recorded 2026-11-07 for the application implementation on `main`. These are observed local checks. They do not complete the original live-service gates.

| Check                                                                   | Observed result                                                                           | Scope                                                                                                |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm run check`                                                         | Passed: TypeScript, ESLint, 55 unit tests, server and Vite production builds              | Local code/build; test doubles are isolated under tests                                              |
| `npm run test:database` with an empty disposable PostgreSQL 16 database | 14 tests passed                                                                           | Actual SQL/migration/locking/MCP HTTP; test-only minimal Supabase auth schema                        |
| `node spikes/switch-mention/spike.test.mjs`                             | 12 tests passed                                                                           | Isolated Phase 0 parser/operator-approval checks; no real room claim                                 |
| Built server HTTP smoke                                                 | 15 checks passed, including 5 generated assets                                            | Actual local server: dashboard HTML/assets, safe config, missing-auth rejection, invalid OAuth state |
| `npm audit --omit=dev --json`                                           | 0 reported vulnerabilities                                                                | Current production dependency advisory scan; not a complete security assessment                      |
| `npm run doctor`                                                        | Local encryption configured; direct OpenCode CLI reports 1.19.0; account settings missing | Presence/version checks only; no model or account connection attempted                               |
| `git diff --check`                                                      | Passed before commit                                                                      | Whitespace integrity                                                                                 |

The database suite runs the real migration runner twice, verifies its hash tracking, then exercises concurrent action claims, result replay without duplicate task writes, wrong identity, rejected/tampered approvals, illegal-transition rollback, the final hop under concurrency, own-row reads, denial of browser mutations/private-token reads and role-scoped MCP over local HTTP. It also checks duplicate handoff IDs, the outbound-receipt/SSE race, copied signed message rejection and stopped-run write denial.

The tests exposed an audit foreign-key deadlock when business records were locked with FOR UPDATE while a separate audit insert requested a key-share lock. Stable business-row locks now use FOR NO KEY UPDATE; the actual concurrent database tests pass. This is local SQL evidence, not Supabase-hosted service evidence.

Unit tests cover validation, the state machine, approval scope/hash/expiry/creator checks, token encryption/AAD, signed handoffs, untrusted mentions, Slack decision parsing, provider write-intent binding, connection-version binding, mandatory checks around token refresh, required real-thread evidence, bounded PDF extraction and private-key preservation during env initialization. Switch parser/handshake fixtures reflect inspected source contracts; they do not prove the deployed server accepts the combined runtime.

## What has not passed

- Fresh hosted Supabase migration, verified sign-in and Realtime delivery.
- Live Slack app installation, creator identity, channel/bridge adoption and room visibility.
- Custom SSE mention/reply and actual OpenCode model/MCP tool reply in Slack.
- Three-agent registration and two-agent round-trip under the effective deployed policy.
- Google consent, refresh/revocation and every tool against the real test account.
- Real sponsorship analysis and creator-only rejected/approved campaign execution with provider readback.
- Two fresh E2E batches, including observable injection isolation and transcript review.
- Browser visual/mobile/keyboard review: computer-use inventory exposed no browser/app surfaces. Build/HTTP checks do not establish rendered appearance.
- Public HTTPS deployment, backup/restore and licensing review for paid hosting.

Switch services remain stopped; application tests did not restart them. The disposable PostgreSQL container and smoke-test server are stopped during teardown. No live-service evidence is inferred from test data or configuration presence. CI results are attached to the pushed commit in GitHub Actions; this document records local checks and should not be read as a remote CI success claim.

## Operational limits to carry into live validation

The application-owned OpenCode host uses the pinned source-backed SSE compatibility route; SSE is deprecated upstream. The combined deployed host/model/protocol pairing and effective addressing policy are still open. Native controller discovery is separate from this application-owned host.

Thread-read proof is scoped to the authenticated creator/task/Brand Agent because tool_calls has no run_id column. Each MCP request separately verifies its active run, role and task. Google write tools additionally recheck the active run, exact approval/action and connection binding immediately before dispatch. Stopping a run prevents new claims; Google may finish a request already accepted before cancellation. An uncertain result requires provider/audit reconciliation, never an automatic repeat.

Default Drive scope is drive.file; arbitrary existing briefs are not reachable without an explicit app grant or optional drive.readonly consent. The application does not simulate inaccessible content. Large-workspace pagination, history recovery and provider rate limits require real-account stress tests.
