# Phase 0 runbook

Status: the local Switch stack passed readiness on 2026-11-06. Slack and agent room tests have not passed. No Phase 1 work is authorized yet.

**Current boundary (2026-11-06):** the user resumed live setup, supplied a Slack workspace URL and enabled Docker. The isolated stack is running; continue with the [Slack setup guide](SLACK_SETUP.md). Both real room probes remain mandatory.

## Prerequisites

Run commands from the Creavate repository root. Node with built-in node:sqlite is required for this disposable probe; this machine's Node 26.13.0 was checked. The standalone protocol probe needs no npm dependency installation. Building the optional official headless OpenCode controller uses upstream workspace dependencies in ignored .local/. No product monorepo has been scaffolded.

The cloned official source must be at 0d2a57ce643a57a56cd955f6a80324327558f0dd. Keep it under ignored .local/upstream-switch. A fresh checkout can obtain it with:

```sh
git clone https://github.com/sandbox-quantum/switch.git .local/upstream-switch
git -C .local/upstream-switch checkout --detach 0d2a57ce643a57a56cd955f6a80324327558f0dd
```

Start the installed Docker daemon from your own local terminal:

```sh
sudo systemctl start docker
docker info
```

The second command must work for this account before the agent can run the stack. On this machine the user started Docker and added their account to the Docker group; the existing agent process uses a newgrp docker child to obtain the refreshed group. Do not send a sudo password in chat. The project did not install Docker or change system permissions.

## Prepare and start the official source-built stack

```sh
python3 scripts/phase0/prepare-switch.py
```

This calls the upstream secret generator, pins a local source-build tag, protects the ignored .env with mode 0600, and refuses to overwrite an existing configuration. It does not start Docker or print credentials. Keep the deployment name localhost for this disposable stack; do not change it after first startup.

Check that loopback ports 18000, 13000 and 15432 are free. Then validate the official Compose plus its source-build override:

```sh
docker compose --project-name creavate-phase0 \
  --project-directory .local/upstream-switch \
  --env-file .local/upstream-switch/.env \
  -f .local/upstream-switch/deploy/local/standalone-docker-compose.yml \
  -f .local/upstream-switch/deploy/local/standalone-docker-compose.build.yml \
  --profile gateway config --quiet
```

Build and then start the same isolated project (run each command from the repository root):

```sh
docker compose --project-name creavate-phase0 \
  --project-directory .local/upstream-switch \
  --env-file .local/upstream-switch/.env \
  -f .local/upstream-switch/deploy/local/standalone-docker-compose.yml \
  -f .local/upstream-switch/deploy/local/standalone-docker-compose.build.yml \
  build --build-arg SWITCH_GIT_COMMIT=0d2a57ce643a57a56cd955f6a80324327558f0dd \
  --build-arg SWITCH_GIT_REPOSITORY_URL=https://github.com/sandbox-quantum/switch switch gateway

docker compose --project-name creavate-phase0 \
  --project-directory .local/upstream-switch \
  --env-file .local/upstream-switch/.env \
  -f .local/upstream-switch/deploy/local/standalone-docker-compose.yml \
  -f .local/upstream-switch/deploy/local/standalone-docker-compose.build.yml \
  --profile gateway up -d --no-build
```

These commands completed on 2026-11-06. This creates a separate Compose project and uses the recorded source, not an unverified published latest tag. Mattermost's collab profile is omitted because the gate requires Slack.

Verify actual health:

```sh
curl --fail --silent --show-error http://127.0.0.1:18000/health
curl --fail --silent --show-error http://127.0.0.1:18000/health/ready
```

Open the Gateway at http://127.0.0.1:13000. Read the generated admin login locally from .local/upstream-switch/.env; keep it out of screenshots/transcripts. Create a personal registration key on API Keys so the probe belongs to that signed-in user.

## Connect your Slack workspace

Use the [step-by-step local setup guide](SLACK_SETUP.md) and the exported [actual server manifest](slack-app-manifest.json). The Gateway labels its form **Register messaging app**; Slack app creation happens on Slack's website.

Required non-secret information: workspace URL, workspace/team ID (T...), dedicated test channel name and channel ID (C... or G...), and confirmation that you can install an app.

1. From the running Gateway/Console messaging-app setup, obtain the server-generated Slack app manifest. The authenticated setup route is /gateway/collaborations/setup/slack. Use the installed server's manifest and resolve any Slack validation error explicitly; historical checked-in examples differ.
2. Create/install an app in your test workspace using that manifest. Enable Socket Mode and interactivity as specified by the official setup.
3. Generate an app-level xapp token with connections:write; obtain the installed bot's xoxb token.
4. In Switch messaging apps, connect Slack with bot_token, app_token, workspace_id. These fields are stored by Switch; do not commit or paste them into chat.
5. For the dedicated test, turn channel creation off and use an existing channel. On a free Slack plan, disable agent autocomplete and type the agent's exact name.
6. Link your Slack user to your signed-in Switch account. Invite the app into the dedicated channel. Confirm that it appears as a Switch room.
7. Copy the actual Switch room UUID. It is different from Slack's channel ID.

Official instructions: [Slack](https://docs.switchagents.ai/switch-rooms/deploy/messaging-apps/slack), [hosting](https://docs.switchagents.ai/switch-rooms/deploy/self-host). If you need to stage Slack tokens locally, use an ignored .env file with mode 0600; the probe itself does not need direct Slack credentials.

## Register the disposable custom agent with a recorded grant

Copy .env.example to .env.phase0 with mode 0600 (use umask 077 before copying), then set the actual Switch base URL, personal registration key, probe name and room UUID. Set PHASE0_OPERATOR to your human operator identity and PHASE0_APPROVAL_ID to a new UUID. Do not set test IDs as live values.

Review the exact registration plan:

```sh
node --env-file=.env.phase0 spikes/switch-mention/spike.mjs plan --mode=register
```

The human operator records the reviewed grant by supplying that returned digest:

```sh
node --env-file=.env.phase0 spikes/switch-mention/spike.mjs approve --mode=register --confirm=<reviewed-digest>
node --env-file=.env.phase0 spikes/switch-mention/spike.mjs register
```

The granted plan is scoped to this base URL and probe identity, expires after two hours, and permits one registration attempt. The returned agent API key is written to ignored .env.phase0-agent with mode 0600 and is never printed. No overwrite/re-registration fallback exists.

Invite the registered agent into the existing room via the owner/admin UI or the documented Slack command:

```text
/invite-agent @creavate-phase0-probe
```

Read actual history to identify your linked Switch sender ID:

```sh
node --env-file=.env.phase0 spikes/switch-mention/spike.mjs history
```

This prints participant identifiers from a real response, without message bodies. Set SWITCH_EXPECTED_SENDER_ID to your actual opaque Switch identity. Verify its identity against the linked account; never infer it from the Slack ID.

## Run the actual mention -> SSE -> reply probe

Set a NEW PHASE0_APPROVAL_ID. Review and record the separate connect/reply plan:

```sh
node --env-file=.env.phase0 spikes/switch-mention/spike.mjs plan --mode=listen
node --env-file=.env.phase0 spikes/switch-mention/spike.mjs approve --mode=listen --confirm=<reviewed-digest>
node --env-file=.env.phase0 spikes/switch-mention/spike.mjs listen
```

Within 180 seconds, the linked creator posts one message mentioning @creavate-phase0-probe in the dedicated Slack channel. The probe:
- opens the documented SSE compatibility connection and records the actual connection_state;
- authenticates heartbeats while the recorded grant is valid;
- responds only to addressed=true from the exact configured sender and room;
- reads real room history, posts one reply containing the returned message count/truncation, and reads that reply back;
- consumes its reply grant before I/O; any ambiguous write failure requires review, not automatic retry.

No LLM is needed to establish this transport contract. This deliberately limited agent never interprets message text as instructions and has no Gmail, Drive, Calendar or shell tool.

Evidence is private in .local/phase0/probe.sqlite: approvals, attempted writes and returned receipts, plus observations. Do not publish raw workspace IDs or room content. A returned Switch event ID proves server acceptance; independently confirm the matching reply is visible in Slack before marking the gate passed.

The probe fails visibly on a gap, eviction, expiry, stream end, timeout, unexpected response or failed readback. It does not reconnect automatically, pretend completion, synthesize tool results, or continue to another phase.

## Local checks and stopping point

```sh
node spikes/switch-mention/spike.test.mjs
node --check spikes/switch-mention/spike.mjs
git diff --check
```

The unit file reports the individual named checks when run directly. Tests are isolated synthetic inputs; none proves Slack, Switch, model or Google behavior.

After live evidence is verified, update TASKS.md and OBSERVATIONS.md, commit Phase 0, report open questions, and stop for review. Phase 1's first action after explicit approval is the npm-workspace/tooling scaffold, followed by a real fresh-Supabase migration gate.

## OpenCode route: live verification pending

The custom SSE probe above is a protocol diagnostic. It does not establish the selected OpenCode runtime. Before Phase 0 can pass, use the documented Switch session host with a separately registered OpenCode identity and capture a real Slack mention, actual Switch MCP tool return, posted receipt and independent Slack-visible reply.

First verify the exact Core/Console/OpenCode version pairing and the tools exposed to the role. The inspected adapter uses an older OpenCode configuration shape; V2 compatibility is unresolved. Do not install an old connector plugin, enable full-access mode or silently rewrite the user's native OpenCode configuration.

The host supplies the local Switch MCP server and managed skill. Keep the agent working directory and credentials private. The future Google MCP server must authenticate each role and enforce verified creator approval inside every write tool; the default host MCP permission behavior does not establish that guard.

See [the sourced runtime findings](../../SWITCH_INTEGRATION.md#14-opencode-and-claude-code-runtime-setup) and [creator-only approval requirements](../../SWITCH_INTEGRATION.md#15-creator-only-approvals-and-revised-live-gate). No OpenCode provider/model request has been run.


### Pinned headless controller preparation (executed)

The current controller source supports OpenCode and can run in a foreground process. Enable `agent_management`, generate `CONTROLLER_TOKEN_SECRET` and set `GATEWAY_PUBLIC_URL` to the Core URL. The fresh setup helper now does this without overwriting an existing env. These settings were applied privately before this stack started.

The source at the recorded pin was built with its declared pnpm 10.28.2. The following steps passed; they affect only ignored project-local tooling and the upstream checkout, not global OpenCode or system services:

```sh
npm install --prefix .local/phase0-node-cli --cache .local/phase0-npm-cache \
  --ignore-scripts --no-audit --no-fund --save-exact pnpm@10.28.2

node .local/phase0-node-cli/node_modules/pnpm/bin/pnpm.cjs \
  --dir .local/upstream-switch/console --filter @switch-console/agent-controller... \
  install --frozen-lockfile --ignore-scripts --store-dir "$PWD/.local/phase0-pnpm-store"

node .local/phase0-node-cli/node_modules/pnpm/bin/pnpm.cjs \
  --dir .local/upstream-switch/console --filter @switch-console/agent-controller... -r run build

node .local/phase0-node-cli/node_modules/pnpm/bin/pnpm.cjs \
  --dir .local/upstream-switch/console --filter @switch-console/agent-controller run package

node .local/upstream-switch/console/packages/agent-controller/dist-package/package/cli.mjs --version
```

The shell expands $PWD to the repository root before pnpm changes directory. The final command returned 0.1.1. See OBSERVATIONS.md for the tarball hash and real isolated OpenCode health result.

**Still to run:** enroll through a real one-time Machines code with `--secret-store file` and an ignored data directory, then start `run` in the foreground. Provision the verified owner's separate OpenCode probe identity with explicit provider/model, no full-access bypass, and private working directory. Verify the selected binary/permissions actually used by the host before sending a room mention. Managed agents use the controller's WebSocket relay; use a different unmanaged identity for the SSE probe. No controller has been enrolled and no managed agent/model session has run yet.


The user selected OpenCode's built-in backend for the live test. The real isolated provider inventory's default model is `big-pickle`; use the verified adapter syntax `opencode/big-pickle`. Its inventory listing is not evidence that a model request or Switch MCP call has succeeded. Keep this choice in configuration; no API key is needed to inventory the selected backend.
