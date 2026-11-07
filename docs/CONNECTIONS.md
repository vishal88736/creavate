# Connect accounts through Profile

The site is where creators connect Google and Slack. A developer must first configure the application registrations that enable those OAuth flows. Secrets are stored only in ignored `.env` or encrypted private database rows. No API secret has a `VITE_` prefix.

## 1. Supabase and application login

Create a fresh development project. In `.env`, set DATABASE_URL (direct PostgreSQL or the session pooler for the migration runner, not the transaction pooler), DATABASE_SSL=true, SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (publishable or legacy anon key only). A secret/service-role key is deliberately rejected from the public-key field. SUPABASE_SECRET_KEY is reserved for operator tooling and never returned to the browser.

Set CREATOR_EMAIL to the verified email that will own this deployment. Sign in using the configured Supabase Google provider or an existing verified email/password account. One creator workspace is hosted per agent-server deployment; database reads are still isolated by user ID.

For Google sign-in, follow [Supabase's Google guide](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), using the callback shown by your project. Add `http://127.0.0.1:5173` to Supabase's allowed site/redirect URLs for local development. Then run `npm run db:migrate`.

## 2. Google integration OAuth

In Google Cloud, enable Gmail API, Drive API and Calendar API. Configure the consent screen and test user, and create a Web application OAuth client.

Set:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI=http://127.0.0.1:8787/oauth/google/callback
```

Register that exact callback in Google Cloud. This integration callback is distinct from Supabase's authentication callback. Both can be registered on the appropriate web client.

In Profile → Connections, choose Connect Google and complete consent. The server stores the refresh/access tokens encrypted with TOKEN_ENCRYPTION_KEY, bound to the application user. An expiring access token is refreshed under a database lock.

Scopes:

- `gmail.readonly`: inquiry threads, attachments and mailbox notifications; no send/modify access.
- `drive.file`: campaign files created by this app and files explicitly made available to it. It does not grant arbitrary existing-Drive search or reading.
- `calendar.events`: create/read approved deadline events. No Calendar sharing or account-management scope.
- Optional `drive.readonly` when GOOGLE_DRIVE_READ_ALL=true: needed to search/read arbitrary existing briefs. This broadens read access and requires renewed creator consent. Default is false. It still does not grant arbitrary Drive write access.

GOOGLE_DRIVE_PARENT_ID is an optional app-accessible campaign root. GOOGLE_CALENDAR_ID defaults to primary. Brand analysis can read Gmail PDF/text attachments; binary formats without supported text extraction are explicitly identified. Files remain untrusted data.

## 3. Slack installation and identity

Create a Slack app using the [source-backed manifest](phase0/slack-app-manifest.json). Add this OAuth redirect in Slack:

```text
http://127.0.0.1:8787/oauth/slack/callback
```

Set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, and SLACK_APP_TOKEN (`xapp-` with connections:write) in `.env`. The app uses Socket Mode for Switch. Set SWITCH_GATEWAY_EMAIL/PASSWORD so the server can register the actual bridge through the verified Gateway route. User OAuth supplies the bot token; it is encrypted in the database, not exposed in the site.

Choose Connect Slack in Profile. The authorization-code exchange establishes the consenting Slack user ID. The server verifies that it is a real, non-deleted human. Invite the app into a dedicated channel, then select it in Profile. Private channels must be visible to the installed app.

The channel selector paginates in 200-result pages using Slack’s returned cursor. Use Load more channels when the desired channel is on a later page.

Approval commands must be the full message:

```text
approve <actual-approval-UUID>
reject <actual-approval-UUID>
```

The request includes the real UUID, expiry and complete action list. The backend reads Slack history/replies with the connected bot, accepts only the OAuth-linked creator ID, rejects bots/subtypes and deduplicates the Slack message timestamp. Switch room text alone cannot approve anything. The dashboard uses the verified Supabase identity instead.

## 4. Switch and OpenCode

Start your existing source-pinned Switch deployment using the [discovery runbook](phase0/RUNBOOK.md). Its local URL is `http://127.0.0.1:18000`; its Gateway is `http://127.0.0.1:13000`. Services were stopped when requested and are not automatically started by Creavate.

Create a personal registration key for the human Switch owner, set SWITCH_REGISTRATION_KEY and Gateway credentials, then choose Connect room in Profile. All three identities must belong to that same owner, with the effective owner-and-owner-agents policy verified on the deployed server. Do not broaden to anyone to bypass a policy failure.

Registration results are stored encrypted. Existing identities are reused; duplicate-name conflicts are surfaced rather than overwritten or silently rotating keys. A crash after registration but before credential persistence requires operator reconciliation.

Set OPENCODE_BIN to a direct verified compatible executable. Discovery checked 1.19.0 against the older flat MCP configuration used by the pinned Switch adapter. Global OpenCode 2.x compatibility is unproven; do not replace your global installation to make a test pass. OPENCODE_MODEL defaults to the built-in inventory's observed `opencode/big-pickle`. Inventory is not proof of model availability. The current isolated host supports this selected built-in backend without inheriting unrelated user MCP servers or Google credentials.

Only start the agents after accounts, room and model access are ready. Startup uses source-verified HTTP/SSE, authenticated per-run Creavate MCP and deny-default native tool permissions. Session tokens are scoped to user, role, task, run and expiry. Native final text is not posted as an execution result.

## 5. Gmail ingestion and live gates

Polling is the default; it reads up to five 50-message pages from the configured lookback, deduping by Gmail ID. Every message is classified by Brand Agent, not a keyword-only filter.

For push, set GMAIL_INGESTION_MODE=push, configure the topic/subscription and set GOOGLE_PUBSUB_TOPIC, GOOGLE_PUBSUB_AUDIENCE and GOOGLE_PUBSUB_SERVICE_ACCOUNT. Push calls `/api/webhooks/gmail`; Google OIDC signature, issuer, audience, verified service email and target mailbox are checked. Watches renew before expiry. Polling remains a catch-up path. Follow [Google's push guide](https://developers.google.com/workspace/gmail/api/guides/push).

Use manual mode for isolated E2E batches; it disables background scanning, while Check inbox and explicit real-message ingestion remain available. Never put a fabricated message ID or provider result in configuration as gate evidence.

See [VERIFICATION.md](VERIFICATION.md) for actual local checks and pending live gates.

Google reconnects rotate the connection version. Previously approved plans cannot write using replacement credentials; review/reconcile any partially executed campaign before requesting a fresh plan. Stopping a run blocks new action claims, but an external request already accepted by Google may still finish; preserve its receipt or reconcile it before retrying.
