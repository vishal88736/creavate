# Deployment and operations

Build with `npm ci && npm run build`; run `npm start` from the repository root. The Express server serves dist/web and the API, binding to loopback by default. Use an HTTPS reverse proxy and set WEB_URL, API_URL and provider callbacks to your real deployment. Keep the MCP host URL reachable by the local OpenCode processes; no agent endpoint is unauthenticated.

Apply migrations with `npm run db:migrate` to a fresh development Supabase project before production. The migration runner checks content hashes and refuses edited, previously applied migrations. Preserve database backups and the encryption key together; losing TOKEN_ENCRYPTION_KEY prevents token decryption. Do not rotate it without a planned token re-encryption/reconnect procedure.

Secrets are deployment environment settings; `.env` is for local execution and must stay private. Publishable Supabase configuration is the only intentional browser-facing configuration. Encrypt database backups and restrict operator access to DB credentials, Switch registration/Gateway credentials and OAuth secrets.

Set CREATOR_EMAIL for the one creator served by this host. Register separate Google/Slack applications and Supabase projects for staging and production. Configure each redirect allowlist for its own environment. Complete applicable provider verification/review before opening beyond authorized test users.

Use a supervisor for the app and a separate supervisor for Switch. The app does not install system services. ENABLE_WORKERS=false leaves workers stopped until the creator starts them in Profile; true attempts startup for an already configured owner/room. After a stream gap, takeover or unrecoverable failure, inspect the activity log before restarting. Persisted cursors/duplicate receipts prevent treating a fresh connection as an excuse to repeat writes.

Monitor `/api/health` for actual database reachability and runtime readiness. Configuration presence is distinct from provider health. Alert on agent_run failures, handoff state uncertain, approval_executions state claimed/uncertain, expired pending approvals and watch renewal errors. Tool records contain actual results/errors, duration and approval IDs; application logs deliberately omit credentials and raw provider errors.

Uncertain writes are never automatically repeated. Known-resource failures are read back from Google and only recorded successful when the real metadata/content checksum matches. Unresolved or ID-less copy failures require an operator to inspect the provider and audit rows. Preserve partially created artifacts and audit evidence; do not claim rollback or delete data automatically.

Before public launch, complete every live gate in TASKS.md, browser/mobile review, backup/restore rehearsal, large-workspace pagination and history recovery stress tests, rate-limit testing, and the Switch commercial licensing decision. Local tests do not establish these outcomes.

Google approvals are bound to the connected account and connection version. Reauthorizing Google rotates that version; an old approved plan cannot write with the replacement connection. Reconcile any partial artifacts and create a fresh reviewed plan rather than changing a stored approval.
