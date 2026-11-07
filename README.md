# creavate.

**Create more. Coordinate less.**

Connect platforms. Collaborate with AI. Focus on creating.

Creavate coordinates sponsorship inquiries across Gmail, Slack, Google Drive and Calendar. Brand Agent analyzes an inquiry, Talent Manager asks the creator to approve the exact action plan, and Campaign Agent organizes the approved campaign. Agent handoffs use separate real Switch identities; OpenCode runs the tool-calling sessions.

**Current status:** the application is implemented for account connection and live verification. Local security/database tests and builds are distinct from external-service gates. No live Google/Slack/OpenCode campaign run has passed yet. The prior Switch discovery stack was stopped at the user's request. See [TASKS.md](TASKS.md) and [verification evidence](docs/VERIFICATION.md).

## Start locally

Requirements: Node.js 24+, npm, a development Supabase project, Google OAuth application, Slack app and self-hosted Switch. OpenCode needs a direct compatible executable; discovery verified the local 1.19.0 CLI/server, while its actual model/tool round-trip is still pending. All repository work stays on `main`.

```sh
npm ci
npm run env:init
# Fill the developer settings in .env using the connection guide.
npm run doctor
npm run db:migrate
npm run dev
```

Open **http://127.0.0.1:5173**. Sign in through Supabase, then go to **Profile & connections**:

1. **Connect Google** authorizes Gmail, Drive and Calendar. Tokens are encrypted server-side.
2. **Connect Slack** installs/authorizes the configured app and verifies the creator's Slack identity.
3. Invite the Switch app into your Slack channel, then select that channel in Profile.
4. **Connect room** provisions the three identities and adopts the real Slack channel through the sourced Switch Gateway APIs.
5. **Start agents**, then **Check inbox**. Workers remain off by default until explicitly started.

Developer application secrets belong in ignored `.env`; users connect personal accounts through the website. Issued OAuth credentials and agent keys are encrypted in private database tables, not placed in browser bundles. The safe public template is [.env.example](.env.example). `env:init` initializes empty signing/encryption keys once, preserves existing values and adds newly available configuration names.

Read [CONNECTIONS.md](docs/CONNECTIONS.md) for exact redirect URLs, dashboard setup and each environment group. Filling `.env` does not replace Google/Slack consent or app installation.

## What is implemented

- Reference-inspired responsive React dashboard: overview, inbox, deals, approval review, campaigns, agent runs, live activity/tool calls, and Profile connections. Empty accounts show real setup/empty states; there are no canned deals or fabricated metrics.
- Express API with verified Supabase authentication, creator restrictions, strict validation, rate limits and security headers.
- Supabase migrations with own-row reads, private token/credential tables and no browser approval writes.
- Google authorization-code flow with state, browser binding, PKCE, encrypted offline tokens and serialized refresh.
- Gmail polling and authenticated Pub/Sub push-triggered ingestion, message-ID deduplication and Brand Agent classification. Push still has periodic catch-up polling; watches renew before expiry.
- Read-only Brand tools for real threads, attachments, PDF/text briefs and OAuth-accessible Drive search.
- Separate Switch identities and a source-backed HTTP/SSE adapter with heartbeats, persisted cursors, signed task handoffs and duplicate-event protection.
- Isolated OpenCode sessions with deny-default native permissions and authenticated, role-scoped MCP. Raw email content never supplies tools, permissions or approval identity.
- Immutable approval manifests, verified creator decisions from dashboard or actual Slack messages, exact deal/action binding, expiry and exclusive action claims.
- Approved Drive folders, original-inquiry files, attachment uploads, brief copies, Calendar deadlines/reminders and task lists. Each Google artifact write is checked inside the provider layer and verified by reading it back.
- Real tool-call/activity records, Supabase Realtime updates, task transitions, a default six-hop cap, per-run tool budgets, timeouts and visible failure reporting.

The tool layer also supports an explicitly approved Drive move. Default plans copy briefs to preserve originals. No outbound sponsorship-email sending, Instagram or YouTube integration is included.

## Approval boundary

A model cannot approve its own plan. The API authenticates the creator through Supabase; chat decisions are read back from Slack and matched to the human identity established by Slack OAuth. Bot messages, other room members and quoted/embedded approval text are rejected.

Every action is bound to the creator, task, deal, exact manifest hash and action ID. Actual Google parameters are compared to the recorded plan inside the Google write layer. Exclusive database claims prevent duplicate writes. Ambiguous failures trigger readback where the resource ID is known; unresolved results remain `uncertain` and are not blindly retried. Partial artifacts remain visible in the audit log for review.

## Commands and validation

```sh
npm run check             # TypeScript, lint, isolated unit tests, production builds
npm run test:database     # Requires an empty disposable TEST_DATABASE_URL
npm run test:integration  # Requires RUN_LIVE_TESTS=true and real connected accounts
npm run test:e2e          # Two fresh real-message batches; real creator decisions
npm run build
npm start                # Serves API and built dashboard on 127.0.0.1:8787
```

For `npm start`, set WEB_URL to the actual serving origin and update provider redirect allowlists accordingly. Public hosting needs an HTTPS reverse proxy. See [DEPLOYMENT.md](docs/DEPLOYMENT.md).

Database tests use a minimal test-only auth fixture on real PostgreSQL. They establish SQL invariants, not live Supabase Auth/Realtime behavior. Mocks exist only under automated tests. The live integration command refuses to replace missing accounts with fixtures. [Fixture guidance](tests/fixtures/README.md) provides isolated email inputs for the real inbox cases; [DEMO.md](docs/DEMO.md) gives the operator runbook.

## Repository

```text
apps/web                  React + Vite + Tailwind + shadcn-style Radix components
apps/server               Express, OAuth, ingestion, workflow, MCP and worker host
packages/shared           Zod schemas, state/approval invariants, signing/encryption
packages/switch-adapter   The only Switch wire/Gateway protocol boundary
packages/agents           OpenCode provider, role instructions and tool allowlists
packages/google-mcp       Real Google functions and exact-action write checks
supabase/migrations       Schema, RLS, approvals, audit records and Realtime tables
tests/unit                Isolated security/parser tests (mocks only here)
tests/database            Disposable PostgreSQL invariant tests
tests/integration         Explicit live-account checks
scripts                   Env setup, doctor, migrations, provisioning and E2E
```

## Discovery and remaining gates

The user authorized implementation ahead of live account connection. This changes build order, not evidence: the original live gates remain open. [SWITCH_INTEGRATION.md](SWITCH_INTEGRATION.md) records verified sources and unresolved protocol/runtime questions, and [DECISIONS.md](DECISIONS.md) records the implementation choices.

The application-owned OpenCode host is a separate implementation candidate from Switch's bundled headless controller. It uses the sourced OpenCode SDK contract and Switch's deprecated-but-documented SSE compatibility path. No claim is made that the native controller route or this combined route passed the real Slack gate. The source pin and deployed protocol must be reviewed during live validation.

Before v1 is considered done: apply migrations to fresh live Supabase; verify all three identities and a real room handoff; exercise every Google tool; prove creator-only rejection/approval behavior; verify live dashboard updates; and pass two real clean-message E2E batches including injection isolation.

## Design and licensing

The supplied [dashboard reference](docs/design/dashboard-reference.png) guided the pale surfaces, purple accents, navigation, overview and activity rail. Application data drives every operational entry.

Switch is external software under its own [Apache 2.0 plus modified Commons Clause terms](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/LICENSE). The paid-hosting/licensing decision remains open. Creavate's own license has not been selected. No generated credentials or private runtime evidence belongs in this public repository.
