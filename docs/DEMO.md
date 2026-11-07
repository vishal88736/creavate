# Real-account demonstration runbook

This guide describes actions to perform after account connection; it is not a transcript of an already successful run. Use a dedicated inbox, Slack channel, Drive root and Calendar. Preserve audit records and all real provider receipts.

## Prepare

1. Configure developer settings with `.env.example` and `docs/CONNECTIONS.md`; run `npm run doctor` and apply migrations to a fresh development Supabase project.
2. Start the pinned Switch stack and the app. Sign in, connect Google and Slack in Profile, select the dedicated joined channel, connect the room and start the agents.
3. Confirm all three identities in the real room and run the source-backed Phase 0 mention tests. Verify actual replies in Slack before claiming that gate.
4. Run `npm run check`, then the explicitly enabled live integration checks. Configuration readiness is not a provider-health assertion.

## Walk through a campaign

1. Send a copy of `tests/fixtures/good.eml` into the real test inbox after editing its recipient and future deadlines. Attach a small text/PDF brief to exercise attachment reading and filing. For arbitrary existing Drive briefs, consent to the documented optional read scope or explicitly grant the file to the app.
2. Check inbox. Observe the real inquiry, Switch handoff, Brand Agent thread read and structured deal summary. Open the tool-call record to inspect actual result/error, duration and task reference.
3. Open the pending approval. Inspect the Google account, exact folder/file/calendar/task actions, rights flags and expiry. Confirm that no campaign artifacts exist yet.
4. Reject a separate bad-deal inquiry. Confirm that its audit contains no claimed/executed action and that no artifacts were created.
5. Approve the good deal as the verified creator in Slack using the exact UUID, or in the authenticated dashboard. An agent or another channel member must be rejected.
6. Follow the actual Drive and Calendar links. Read back the folder, original email, attachments, brief copies, deadlines/reminders and task list. Match each result to the recorded approval/action and tool call.
7. Observe activity and tool-call updates from the real Supabase Realtime subscription. Reconnect if the status reports unavailable; do not call cached data a live feed.

## Repeatable acceptance command

Set `GMAIL_INGESTION_MODE=manual`, restart the app, and prepare two sets of four distinct real messages from the provided good/bad/ambiguous/injection fixtures. Set `RUN_LIVE_TESTS=true`, `E2E_EMAIL`, `E2E_PASSWORD` and the eight actual IDs in the documented `.env` fields. Finish or reject unrelated active tasks first.

Run `npm run test:e2e`. It waits for actual creator decisions, verifies clean message batches, denial/approval invariants, role-scoped calls and provider readbacks. It does not insert canned results, approve on behalf of the creator, delete previous audit evidence or fabricate messages. Review the injection analysis and room transcript in addition to the observable automated checks.

If a write is uncertain, stop and reconcile the provider resource and audit record. Do not reapprove, repeat or delete partial artifacts automatically. A failed gate remains failed until its real cause is resolved and the gate is rerun.
