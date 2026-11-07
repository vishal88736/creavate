# Connect the Phase 0 Slack app

The local Switch stack is running. This guide matches the Gateway source at 0d2a57ce643a57a56cd955f6a80324327558f0dd, verified on 2026-11-06. App creation and installation still require your Slack account. No Slack connection has passed yet.

## 1. Sign in to local Switch

Open http://127.0.0.1:13000/login. Read GATEWAY_ADMIN_EMAIL and GATEWAY_ADMIN_PASSWORD from `.local/upstream-switch/.env` in your local editor and enter them in Switch. Do not paste that file, password or a screenshot containing it into chat.

Open **Apps** in the left navigation, or http://127.0.0.1:13000/collaborations. This Gateway has a **Register messaging app** form. It does not create the Slack app for you.

## 2. Create the Slack app from the actual server manifest

1. Open https://api.slack.com/apps and choose **Create New App**, then **From a manifest**.
2. Select the workspace you supplied for this test.
3. Select JSON and paste all of [slack-app-manifest.json](slack-app-manifest.json). This is the response from this running server's authenticated `/gateway/collaborations/setup/slack` route, with no hand-written protocol fields or credentials.
4. Review the permissions and choose **Create**.

The server also returned a prefilled creation URL, saved privately in `.local/phase0/slack-create-url.txt`. You can open that URL instead of copying JSON.

If Slack rejects the manifest, stop and share only the validation message and field path. Do not remove scopes/events or invent replacements to bypass validation. The generated manifest's agent_view/event combination remains an explicitly tracked upstream question.

## 3. Install and get the two tokens

1. In the Slack app settings, open **OAuth & Permissions**, choose **Install to Workspace**, and authorize the app. Copy the **Bot User OAuth Token** beginning with `xoxb-` into the local Switch form's bot-token field.
2. In **Basic Information**, scroll to **App-Level Tokens**. Generate a token named `creavate-phase0` with `connections:write`. Copy its `xapp-` value into the local Switch form's **App-level token** field.
3. In **Socket Mode**, check that **Enable Socket Mode** is on. The supplied manifest requests it; a public webhook/tunnel is unnecessary for this route.

Tokens go into Switch's local form or ignored `.env.phase0`, never into chat or Git. A signing secret is not needed for this Socket Mode connection.

## 4. Register the connection in Switch

Choose **Register messaging app** on the local Apps page:

| Field | Value |
| --- | --- |
| Type | slack |
| Display Name | Creavate Phase 0 |
| Bot Token | Installed bot's `xoxb-` token |
| App-level token | App's `xapp-` token with `connections:write` |
| Workspace Id | Your real Slack team/workspace ID beginning with T |
| Allow creating channels from Switch | Off for this test |
| Agent name autocomplete | Off for this test, especially on a free Slack plan |

The workspace ID is different from its URL/name. In Slack's web client it is the T-prefixed segment of `app.slack.com/client/T.../C...`. If you cannot find it, save the two tokens in the matching empty fields of ignored `.env.phase0` and tell the engineer; the documented setup-check route can look up the actual ID without publishing credentials.

Choose **Register**. Report the status or the error text. Do not repeatedly register if the result is uncertain; the engineer will inspect the real connection first.

## 5. Prepare the test channel

In Slack, create/use `#creavate-phase0` and invite the app named **Agent Switch**. Reply in chat once the connection shows Active and the app is in the channel. The engineer will verify the real bridge/room and then guide the two-sided creator-identity link before registering the test agents. Do not post the probe mention until the engineer says its listener is ready.

An Active bridge alone does not pass Phase 0. The custom SSE probe and the OpenCode agent must each receive a real mention, call an actual room tool, post its real result and have that reply independently confirmed in Slack.

Sources: [Switch Gateway form](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/gateway/src/pages/collaborations/RegisterMessagingAppDialog.tsx), [Switch Slack config](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/bridges/collaboration/slack/adapter.py), [Switch manifest/setup API](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/gateway/collaborations.py), [Slack manifest guide](https://docs.slack.dev/app-manifests/configuring-apps-with-app-manifests/), [Slack Socket Mode guide](https://docs.slack.dev/apis/events-api/using-socket-mode/).
