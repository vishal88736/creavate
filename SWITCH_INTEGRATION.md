# Switch integration discovery

Status: **Phase 0 in progress; live gate NOT PASSED.** No product implementation or Phase 1 work has started.

Baseline inspected on 2026-11-05; reverified on 2026-11-06 (sections 13-15). Official documentation was queried through the public HTTP MCP at https://docs.switchagents.ai/mcp, using `initialize`, `tools/list`, `search_switch_ai`, and `query_docs_filesystem_switch_ai`. The MCP identified itself as Switch AI 1.0.0. Full read responses are kept privately in ignored `.local/discovery/`. This is a direct MCP connection, not a claim that a server was installed into this running coding session. The Claude command is a mise shim; its attempted download was interrupted before installation.

Upstream source: [sandbox-quantum/switch at 0d2a57ce643a57a56cd955f6a80324327558f0dd](https://github.com/sandbox-quantum/switch/tree/0d2a57ce643a57a56cd955f6a80324327558f0dd), cloned under ignored `.local/upstream-switch/`. Main is a development line, not proof of a released image. Its artifact registry declares Core 0.31.0, Console 0.40.1, agent runtime 0.8.0, and agent-protocol speaks 9 / accepts 1. These are separate versions. [Artifact registry](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/artifacts.yaml)

Evidence labels:

- **Docs:** published documentation, read over MCP.
- **Source:** inspected implementation at the commit above.
- **Observed:** a command or request actually run here.
- **Pending:** requires the running stack or a real Slack workspace.

## 1. Can a custom agent onboard by code?

**Docs + Source: yes.** Use `POST /agents`, not `/agents/register-known`. Console is optional for an independently hosted protocol client. The register-known path is for provider types that Console runs.

Authentication is `Authorization: Bearer <registration key>`. A personal registration key is created on the Gateway API Keys page, and its user becomes the agent owner. The deployment bootstrap token assigns a separate non-admin owner; it is unsuitable for silently making these agents belong to the creator's signed-in account. Use a personal registration key for the live test.

Verified request shape:

```json
{
  "name": "creavate-phase0-probe",
  "description": "Disposable mention and room-history probe",
  "connector_type": "creavate-phase0",
  "integration_profile": {
    "connection_model": "always_on",
    "message_exchange": true,
    "pre_invocation_mediation": [],
    "post_invocation_mediation": [],
    "event_reporting": []
  },
  "tools": [],
  "models": [],
  "metadata": {},
  "overwrite": false
}
```

Required fields are name, description, connector_type, and integration_profile. Optional fields include display_name, icon_url, tools, models, metadata, overwrite, and profile.command_capabilities. The name matches `^[a-z0-9][a-z0-9._-]*$`. Response: `{"id":"<agent id>","api_key":"<agent API key>"}`. Persist the issued key privately; do not re-register on every start. A duplicate name returns 409; overwriting rotates the key and replaces the profile.

Sources: [Agent protocol](https://docs.switchagents.ai/switch-rooms/internals/agent-protocol), [registration schemas](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/bridges/agent/api/schemas.py), [registration handler and owner resolution](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/bridges/agent/api/handlers.py), [personal keys](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/gateway/api_keys.py).

**Pending:** register a real identity and verify its owner on the chosen deployment.

## 2. Exact protocol routes and credentials

The bridge base URL is the Switch server address. It is not necessarily the separate Gateway frontend address. Agent requests use `Authorization: Bearer <agent API key>`; a registration key cannot authenticate agent operations. Gateway management uses its authenticated session cookie instead.

| Route | Request | Return / behavior |
| --- | --- | --- |
| `GET /health` | No credential | Public liveness probe; readiness is separate |
| `GET /health/ready` | No agent credential | Checks database readiness; inspect actual response when deployed |
| `POST /agents` | Registration bearer; body above | `{id, api_key}` |
| `GET /agents/{id}/ops` | Agent bearer | `{operations: {name: {description, input_schema}}}` |
| `POST /agents/{id}/ops/{operation}` | Agent bearer; arguments directly as JSON | `{result: <operation result>}` |
| `POST /agents/{id}/message` | Agent bearer; `{room_id, content, metadata?}` | `{ok, event_id}` |
| `GET /agents/{id}/events` | Agent bearer; `Accept: text/event-stream`; query below | Deprecated SSE connection |
| `POST /agents/{id}/connection/beat` | Agent bearer; `{connection_id, generation?}` at inspected source | `{ok, rooms, cursor, position}` |
| `GET /agents/{id}/connection/ws` | WebSocket upgrade; agent bearer; connection query | Preferred event transport |
| `POST /agents/{id}/connection/subscribe` | `{connection_id, room_id, takeover?, generation?}` | Claim an existing membership; cooperative unless takeover |
| `POST /agents/{id}/connection/unsubscribe` | Same connection/room identifiers | Releases the claim |
| `GET /agents/{id}/rooms/{room_id}/history` | Agent bearer; `limit=50`, optional ISO-8601 `since` / `before` | `{events: [{sender, sender_name, body, timestamp}], has_more}` |

Room-bound operations receive `X-Switch-Connection-Id: <connection UUID>`. Their argument object is unwrapped: do not send `{arguments: ...}`. Discover schemas from `/ops` on the actual server before relying on an operation. Distinguish Switch room UUIDs, Slack channel IDs, and opaque transport IDs.

The legacy message schema accepts metadata, but the inspected handler only passes room_id/content to send_message. Do not rely on arbitrary metadata for durable task or approval correlation.

Sources: [HTTP handlers](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/bridges/agent/api/handlers.py), [operation dispatch](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/bridges/agent/api/operations.py), [request/response models](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/bridges/agent/api/schemas.py), [health routes](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/main.py).

## 3. SSE events, mentioning, connection lifecycle

**Plan change proposed:** current documentation prefers HTTP + WebSocket and deprecates SSE. Preserve the specifically requested SSE compatibility spike, then choose WebSocket for production after review. An SSE spike does not establish a long-term SSE support guarantee.

SSE open:

```http
GET /agents/{id}/events?connection_id=<uuid>&scope=single&filter=all&start_from=head&rooms=<room UUID>
Authorization: Bearer <agent API key>
Accept: text/event-stream
```

Optional query fields at the inspected source include protocol, protocol_accepts, client, client_version, expected_generation, spawn_capable, start_at, fallback, and fallback_close_code. Keep one connection UUID per client and reuse it on reconnect. Declare the covered room on open; subscribing only after catch-up can skip replay events. Do not let two processes compete for the same identity/connection.

Domain SSE example (shape, not a recorded event):

```text
id: <per-agent sequence>
event: message
data: {"type":"message","room_id":"<Switch room UUID>","bridge_id":"<bridge id>","channel_type":"channel_public","payload":{"addressed":true,"sender":"<opaque participant id>","sender_name":"<name>","message_id":"<id>","body":"<untrusted text>","timestamp":0,"thread_id":null,"attachments":[]},"sequence":0}
```

The placeholder zeroes above illustrate numeric field types; they are not observations. Source models also permit sender_kind, sender_role, on_behalf_of, opening_message, and switch_notice. Treat sender IDs as opaque; never derive authorization by splitting their string format.

| Domain event | Payload |
| --- | --- |
| message | addressed, sender, sender_name, message_id, body, timestamp; optional thread_id and attachment pointers |
| command | command, args, user_id, user_name, optional thread_id |
| room_join | member, member_name, timestamp, listening |

Connection/control frames include connection_state, gap, evicted, subscription_changed, room_released; WebSocket additionally carries ping/refused. Revision-specific frames include approval_outcome and session_command. Do not assume every frame is a message. The first connection_state supplies the actual rooms, cursor, generation, protocol, heartbeat interval, and server declaration. Store the actual values.

SSE heartbeat cadence is 2 seconds with a 6-second liveness TTL. Return generation from connection_state to fence heartbeats on newer servers. The published SSE example still shows cursor in its heartbeat; the inspected request model instead declares connection_id and generation. Verify the installed server's schema before enabling a newer declaration.

SSE id is textual; Last-Event-ID overrides start_from on resume. A gap must cause history recovery or a visible failure. Stop permanently on taken_over; automatic reopening would steal the connection again. The throwaway probe deliberately fails on a gap/eviction/disconnect instead of concealing missing evidence.

WebSocket opens the same connection at `/agents/{id}/connection/ws`. Frames are `{event, data, id?}`, with numeric id. It sends a ping every 2 seconds; respond immediately with `{"type":"pong","cursor":<last processed sequence>}`. Revision 9 adds multi-source positions; do not conflate a room's seq, an agent event sequence, and a legacy conversation ticket.

A Slack message enters through the collaboration adapter, is persisted/routed, and becomes a message event with payload.addressed for each recipient. An agent acts only on addressed=true, after checking expected sender/room/task. filter=addressed omits command events; filter=all requires this explicit addressed check.

Sources: [Connection documentation](https://docs.switchagents.ai/switch-rooms/internals/agent-connection), [event documentation](https://docs.switchagents.ai/switch-rooms/internals/agent-events), [SSE encoding and connection_state](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/bridges/agent/protocol/stream.py), [event models](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/bridges/agent/protocol/types.py), [position version contract](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/artifacts.yaml).

**Pending:** capture real connection_state, mention message, beat response, reply receipt, and readback.

## 4. Posting and addressing agents or people

Verified operation signatures at the pinned source:
- `post_message({body, thread_id?})` posts to the connection's room and returns `{event_id}`.
- `send_targeted_message({body, target_names?, target_roles?, thread_id?})` targets names from list_participants, or roles. Supply at least one target list. Returns `{event_id, target_statuses}`.
- The operation adds mentions itself: do not prefix body with an extra @.
- A user target is a participant name, not a Slack ID. Human reachability is not represented in target_statuses.
- An agent target may report live, disconnected, no_session, awaiting_manual_poll, or not_permitted. A receipt is not evidence that the recipient completed work.
- The legacy `POST /agents/{id}/message` needs no connection and returns a server event ID. The probe uses this narrow endpoint for one actual history-derived reply.

Source: [Messaging operation definitions](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/bridges/agent/operations/definitions.py), [target status models](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/bridges/agent/protocol/types.py).

No email-supplied @mention, role, instruction, URL, or JSON may choose a routing target. Future handoffs need authenticated sender identities plus validated task/action identifiers backed by application records.

## 5. Rooms and membership

Slack uses Socket Mode for an operator-owned app, so a local test needs no public inbound endpoint. One app serves the registered identities. Inviting the app into an existing Slack channel creates/connects a Switch room. Then invite a registered identity, for example with the documented `/invite-agent @creavate-phase0-probe` command or the authenticated management UI.

Code can create rooms through `create_room`. Required arguments are name, description, agent_names; optional bridge_id and channel_type select the connected platform. For Slack, channel_type is channel_public or channel_private. A caller only joins if its own name is included. Avoid internal_only for the Slack gate. Omitting bridge_id may choose an instance default bridge, so explicitly resolve the intended Slack bridge.

`invite_agent_to_room({room_id, agent_name, include_subagents?})` adds membership. `connect_to_room({room_id, include_general_instructions?})` claims an already assigned room and returns its context; it does not grant membership. Room instructions returned by Switch are distinct from untrusted sponsorship content.

The live test must link the creator's Slack identity to their Switch account. Otherwise an owner-scoped policy may correctly refuse the creator.

Sources: [Connect Slack](https://docs.switchagents.ai/switch-rooms/deploy/messaging-apps/slack), [Create a room](https://docs.switchagents.ai/switch-rooms/getting-started/create-a-room), [room operation definitions](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/bridges/agent/operations/definitions.py), [current Slack setup API](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/gateway/collaborations.py).

## 6. Policy setting and loop limits

**Verified discrepancy:** the protocol page says owner_only is the new-agent default. The current settings page and inspected registration implementation use owner_and_owner_agents. Existing agents retain older policies, including an unset policy that can be open. Read the effective policy on the deployment; do not infer it from a new default.

The three presets are owner_only, owner_and_owner_agents, anyone; scoped custom rules also exist. Phase 2 should use three identities owned by the creator and explicitly verify a policy that permits those handoffs. Do not enable anyone to solve a failed test.

The protocol page shows an agent changing its own addressing via update_agent_detail. The pinned operation calls refuse_managing_self, so use the authenticated owner/admin settings UI for policy provisioning until the chosen server has been tested.

Switch's room/message protocol is not the application's workflow state machine. No inspected primitive establishes a per-Creavate-task hop budget. Implement the required default 6-hop cap atomically with task transitions, duplicate-event protection, and visible failure in the application; do not rely on prompts, room mentions, presence, or token budgets to cap loops.

Sources: [Agent settings](https://docs.switchagents.ai/switch-rooms/getting-started/agent-settings), [actual default policy](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/addressing.py), [registration default](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/bridges/agent/protocol/agent_core.py), [self-management guard](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/bridges/agent/operations/definitions.py), [owner/admin policy route](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/gateway/agents.py).

## 7. Node / TypeScript SDK

The connection docs say there is no public client library. The repository DOES contain a TypeScript protocol client at console/packages/switch-agent-runtime. Its package is `@sandboxaq/switch-agent-runtime`, version 0.8.0, marked private; the artifact registry says bundled, not published. It is reference implementation, not a verified npm dependency.

`@sandboxaq/switch-trust-sdk-ts` is a different product for LLM protection/monitoring. It is not a Rooms client.

Original proposal (superseded by the OpenCode selection in section 13): implement the small HTTP/event contract behind packages/switch-adapter's requested SwitchClient interface, informed by pinned source and live contract checks. Do not vendor the runtime or import a guessed package. registerAgent is provisioning; joinRoom must distinguish membership from a connection claim.

Sources: [Connection docs](https://docs.switchagents.ai/switch-rooms/internals/agent-connection), [private runtime package](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/console/packages/switch-agent-runtime/package.json), [runtime exports](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/console/packages/switch-agent-runtime/src/index.ts), [artifact registry](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/artifacts.yaml).

## 8. Recent room history

`read_context({limit?, since?, before?, room_id?})` returns `{threads, truncated, oldest_timestamp}`. Each thread contains root/replies with entry IDs, sender, body, timestamps, attachments and kind. With no explicit room_id it uses the connection's room.

The legacy history GET in section 2 returns a flattened list and has_more; it omits entry IDs. Both enforce membership. Pagination timestamps are ISO-8601 inputs, while returned timestamps are epoch milliseconds. Convert explicitly and respect truncation.

Source: [read_context implementation and schema documentation](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/bridges/agent/operations/definitions.py), [legacy history conversion](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/bridges/agent/api/handlers.py).

## 9. Built-in human approval primitive

**Source: yes, session-host approval requests exist.** They are separate from the three message event types.

- `POST /agent-sessions/{session_id}/approvals` uses the agent API key.
- Body: request_id, turn_id, kind ("approval" or "questions"), title, detail, options, questions, room_id, thread_id, expires_at.
- Each option has id, label, decision. At the pinned source, decision is accept, acceptForSession, decline, or cancel. Verify these against the installed server; acceptForSession must not authorize unrelated campaign actions.
- An approval view carries state, answer/answers, answeredBy, answeredAt, expiresAt, and deliveredAt (camelCase response aliases).
- Slack renders an approval in the channel root with controls and an explicit text-answer route.
- A revision-capable scope=all agent connection can receive approval_outcome. Undelivered results can also be read at `GET /agent-sessions/approvals/outcomes`, then acknowledged at `POST /agent-sessions/{session_id}/approvals/{request_id}/delivered`. Closing has a separate /close route.

The server persists the request, checks open/unexpired state, and authorizes the answerer through the agent's policy. That is not automatically the creator-only approval requirement. "Answered" is not synonymous with "approved": resolve the chosen option's decision.

Proposed Phase 5 approach: use this UI if its live Slack behavior passes, map its result into the authoritative Supabase approval row, and separately verify creator identity, deal/tenant, exact action manifest hash, expiry, and status before every write. The Talent Manager can request/check approval, but must have no capability to approve its own request. Switch does not replace our Google tool guard or idempotency ledger.

Sources: [approval HTTP schemas/routes](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/bridges/agent/api/activity_routes.py), [decision validation and authorization](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/session_activity/service.py), [Slack renderer](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/bridges/collaboration/session/renderers/slack.py), [durable outcomes](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/session_activity/outcomes.py).

**Pending:** live card/button/text-answer behavior, expiry, identity mapping, and outcome delivery on the chosen Core image.

## 10. Minimum deployment and Slack inputs

Official standalone Compose has postgres:16-alpine, one init-db job creating the runtime role, and switch-core. The optional gateway profile adds the operator UI; collab adds Mattermost and its seeder. Slack does not require Mattermost, Redis, or a Matrix homeserver. Matrix-named wire fields are compatibility identifiers, not a requirement to run Matrix.

Default loopback ports: API 8000, Gateway 3000, PostgreSQL 5432; optional Mattermost 8065. Keep the probe local, with its own Compose project/volumes and unused host ports. Core can also serve built dashboard assets; the selected standalone deployment must be inspected rather than assuming both frontend arrangements are identical.

Required secrets/config include separate database owner/runtime credentials, database name, SECRET_KEYS, initial Gateway admin credentials, AGENT_REGISTRATION_TOKEN, and the stable ID_SERVER_NAME. Do not run the sample with blank secrets or use latest as a reproducibility pin. Bootstrap via the official init-env recipe without printing generated credentials to the transcript.

The self-host docs say to select a server release from the container registry: GitHub releases also contain separately versioned Console/controllers. Source-build at the recorded SHA is an alternative that exactly identifies the inspected code. Choose one and record the actual server declaration/image digest before claiming compatibility.

Slack Socket Mode needs bot_token (xoxb), app_token (xapp with connections:write), workspace_id (T...), app installation permission, and a dedicated channel. Use the server's authenticated `/gateway/collaborations/setup/slack` manifest rather than blindly copying an older manifest; the inspected older checked-in example and published app_home_opened guidance differ. Autocomplete needs paid Slack/user-group permission but plain @agent-name addressing works without it.

Sources: [Self-hosting](https://docs.switchagents.ai/switch-rooms/deploy/self-host), [official Compose contract](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/deploy/local/standalone-docker-compose.yml), [build override](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/deploy/local/standalone-docker-compose.build.yml), [.env.example](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/.env.example), [Slack configuration](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/bridges/collaboration/slack/adapter.py), [generated Slack setup](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/gateway/collaborations.py).

## 11. Observations and live gate

See [observations](docs/phase0/OBSERVATIONS.md) and [runbook](docs/phase0/RUNBOOK.md).

Observed: docs MCP requests succeeded; upstream source cloned; Docker client is installed, but daemon access is denied and the service was inactive. Passwordless sudo cannot start it. The user selected enabling local Docker. No Slack workspace URL, workspace/channel IDs, or credentials have been supplied.

The prepared spike is isolated under spikes/switch-mention. Its runtime invokes actual Switch HTTP/SSE only. Mock data exists only in its automated tests. It requires an operator-recorded, scoped approval ID in a disposable local SQLite ledger before registration, connection claim, or posting; the product's Supabase approval system is not implemented. No probe approval has been minted automatically.

**Not observed:** Switch server health, Slack connection, agent registration, mention delivery, heartbeat, reply receipt, readback, or Slack-visible reply. Phase 0 remains open; Phase 1 is prohibited until the live gate and user review pass.

## 12. Open items for review

| Item | Current finding / required input |
| --- | --- |
| Docker | User is enabling local access; require docker info to work for this running account |
| Slack | Need workspace URL, workspace/team ID, dedicated test channel, app install permission and local tokens |
| Core pin | Source SHA is fixed; released image/digest compatibility not verified |
| Transport | Keep requested SSE probe; approve WebSocket as the production default |
| Policy drift | Confirm effective default and self-update behavior on the actual deployment; provision through the owner UI |
| Approval UI | Built-in source exists; live interoperability and creator-only binding remain unverified |
| SSE heartbeat drift | Published example sends cursor; pinned model declares generation instead. Probe follows inspected model; verify actual deployed response |
| Slack manifest drift | Published docs require app_home_opened when declaring agent_view; the inspected generated manifest declares agent_view but lists only message events. Validate with Slack before changing the plan |
| Compose contract drift | Pinned standalone YAML declares stack-compose revision 1; artifacts.yaml declares revision 2. Source/config validation alone does not resolve deployed compatibility |
| SDK | No public Rooms SDK established; private TS code is reference only |
| Phase 0 write grants | Record operator-approved scope before executing probe writes; no automatic approval |
| Commercial distribution | Upstream license is Apache 2.0 with modified Commons Clause including derivatives and a Sell restriction; intended paid deployment/licensing needs an owner decision, not an assumption |

License source: [upstream LICENSE](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/LICENSE). This records the text and the unresolved product decision; it does not conclude that a particular commercial arrangement is permitted.

## 13. Reverification and runtime decision — 2026-11-06

This is an addition to the existing discovery report, not a replacement for its verified baseline.

### User decisions and current boundary

- **Decision A selected: Slack.** Keep platform/bridge configuration and verified identity mapping outside agent instructions. Discord or Telegram must be a configuration/adapter change, not a change to deal-analysis behavior.
- **Decision B selected: OpenCode agents**, replacing the earlier Claude Code preference. Plan three separately registered Switch identities with OpenCode sessions. A native OpenCode subagent invocation does not establish a Switch identity or the required room-message handoff.
- The user answered **skip** to credential/account setup. Live connection work is deferred; no provider authentication, model invocation, agent registration, Slack posting or Google tool execution was performed.
- This does not pass the Phase 0 gate or authorize Phase 1. The custom Node probe remains an isolated diagnostic/fallback; it is not silently selected as the production runtime.

### Sources rechecked

The official docs MCP was initialized again and queried with search and filesystem reads. Current responses for protocol, connection, events, settings, providers, runtime, Slack and hosting are retained privately in `.local/discovery/2026-11-06/`.

| Existing topic | Reverification result |
| --- | --- |
| Agent registration and HTTP operations | Current MCP protocol page still documents POST /agents with a separate registration key and agent-key-authenticated operations |
| Event transport | Current docs still prefer WebSocket and deprecate SSE; SSE compatibility probe remains pending |
| Connection and deployment instructions | MCP connection and self-host page contents were identical to the earlier cached reads |
| Addressing policies | Protocol/settings disagreement remains; effective policy must be read from the installed deployment |
| SDK and approval HTTP surface | Inspected pinned source remains the basis for the existing schema descriptions; no new live evidence |
| Provider runtime | Current MCP runtime page explicitly lists both OpenCode and Claude Code and describes their host-supplied MCP/skill setup |
| Current upstream comparison | Recorded upstream HEAD fb5780cf67465f6b9f91d77bcad411b20bde6c2b and fetched it for inspection. Working-tree/deployment pin remains 0d2a57ce643a57a56cd955f6a80324327558f0dd |
| Targeted source drift | OpenCode adapter/config, agent API paths, addressing module, standalone Compose and artifacts registry were unchanged between those commits. The TS runtime payload type only clarified legacy owner/admin role handling |

The current upstream comparison is not a deployment upgrade or a claim that all repository files are unchanged. Sources: [comparison](https://github.com/sandbox-quantum/switch/compare/0d2a57ce643a57a56cd955f6a80324327558f0dd...fb5780cf67465f6b9f91d77bcad411b20bde6c2b), [current OpenCode adapter configuration](https://github.com/sandbox-quantum/switch/blob/fb5780cf67465f6b9f91d77bcad411b20bde6c2b/console/packages/agent-providers/src/opencode/config.ts), and the documentation links in the original sections.

## 14. OpenCode and Claude Code runtime setup

### Documented route: session host, local MCP and skill

**Docs + Source:** the current provider route uses Switch Console, its remote sidecar, or the supported managed-agent host. It is not the old standalone connector-plugin installation flow.

1. Install and sign in to the chosen provider on the execution machine, then add the Switch server in Console.
2. Onboard a separate identity with a name, working directory and provider. Console registers it using the signed-in user session; this differs from a custom client's personal registration key.
3. Invite that identity to the intended Slack-backed room and verify the creator's linked identity and agent addressing policy.
4. The session host starts a fresh loopback HTTP MCP server under the name `switch`, with a random port and bearer token. OpenCode receives a remote MCP registration; Claude Code receives an HTTP MCP registration.
5. The watcher holds the authenticated connection to Switch and makes the HTTP operations calls. A room event reaches the model as a delimited `[Switch] ...` input, not as an MCP notification.
6. The host supplies the room-workflow skill: OpenCode gets a managed SKILL.md in its managed configuration home; Claude Code gets it appended to system context.
7. Agents reply by invoking the actual room tools. A model's final text alone does not post the reply into Slack.

Current docs say credentials are stored at `.switch/agents/<name>.json`, mode 0600, with an ignore file. They are not passed as Switch credentials in the model-facing CLI environment. The project also ignores `.switch/`. No such agent credentials were generated here.

Sources: [Sessions and the runtime](https://docs.switchagents.ai/switch-rooms/internals/connectors-and-runtime), [provider prerequisites](https://docs.switchagents.ai/switch-rooms/getting-started/set-up-agent-providers), [onboarding](https://docs.switchagents.ai/switch-rooms/getting-started/onboard-your-agents), [host MCP implementation](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/console/packages/switch-agent-runtime/src/hosted.ts), [watcher tool forwarding](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/console/packages/agent-providers/src/host/watcher-tools.ts), and [single host-neutral Switch skill](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/console/packages/plugins/src/switch-skill/SKILL.md).

### Tools supplied to the agent

The host discovers the operation registry and exposes its actual schemas, plus media tools. The exact tool list comes from the running server, not a guessed SDK list.

| Group | Examples at the inspected source |
| --- | --- |
| Room entry and context | list_rooms, connect_to_room, read_context, list_participants |
| Messages and handoffs | post_message, send_targeted_message |
| Attachments | download_attachment, send_attachment |
| Roles and shared context | list_roles, assume_role, release_role, load_internal_documents |
| Room administration | create_room, update_room, invite_agent_to_room, add_users_to_room |
| Identity/management | list_agents, get_agent_detail, update_agent_detail, managed-agent operations |

Claude Code presents tools as `mcp__switch__<tool>`. The inspected OpenCode configuration matches MCP permissions with `<server>_<tool>` patterns. These names are host formatting, not new Switch API endpoints.

The default catalog is broader than our role allowlists. Host-side tool prompts or native auto mode are not the application's approval guard. Before choosing a deployment, verify both the tools exposed and unauthorized calls rejected for each role, including administrative Switch operations and inherited native tools/MCP servers.

### OpenCode configuration and version compatibility

**Source:** the inspected OpenCode host writes a managed provider home, preserves native configuration/MCP entries and adds Switch's skill and server. Its adapter emits flat `mcp: {server: ...}`, `enabled: true`, and singular `permission` configuration. It can auto-allow registered MCP servers' tool patterns; full-access mode allows everything. Do not enable full-access/bypass mode to make the product pass a test.

**Primary OpenCode docs:** the V2 MCP page uses `mcp.servers` and `disabled` rather than `enabled`, and demonstrates a different permission-rule shape. The installed-provider inventory listing 2.x therefore does not establish that this Switch adapter can drive that runtime.

**Inference, not a live failure claim:** this schema difference is a compatibility risk that needs an exact provider/Core/Console version test. Either use a verified compatible provider version or review a documented adapter update. No downgrade, global configuration rewrite or dependency installation was deliberately performed to resolve it.

Observed locally: mise inventory reported an active OpenCode 2.2.5 installation entry. The actual `opencode` launcher runs a mise install step before forwarding even `--version`; that check failed with a 20-second package-resolution/install timeout. An existing direct package executable was then located without mise; its --version check failed while creating its normal log in the read-only sandbox. This filesystem boundary is not a demonstrated runtime compatibility failure. The CLI version and working session remain unverified. Claude Code's mise inventory was empty; no Claude provider was installed or authenticated.

Sources: [OpenCode adapter config at compared upstream HEAD](https://github.com/sandbox-quantum/switch/blob/fb5780cf67465f6b9f91d77bcad411b20bde6c2b/console/packages/agent-providers/src/opencode/config.ts), [managed OpenCode home](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/console/packages/agent-providers/src/opencode/home.ts), [provider adapter](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/console/packages/agent-providers/src/opencode/opencode-adapter.ts), [OpenCode V2 MCP reference](https://opencode.ai/v2/docs/mcp-servers/), and [OpenCode V1 permissions reference](https://opencode.ai/docs/en/permissions/).

### Claude Code comparison, retained for the requested discovery answer

The current documented setup also supports Claude Code through the same host, not a separately installed legacy connector. The inspected Claude adapter supplies its MCP server configuration and appended system context through the Claude Agent SDK. It explicitly disables the old `switch-connector@switch-plugins` entry when the host supplies Switch, avoiding a second competing connection.

This is source verification only. The user selected OpenCode instead, so no Claude installation, authentication or live Claude spike was attempted. The documentation MCP server (`switch-docs`) is separate from the agent's room MCP server (`switch`).

Source: [Claude adapter MCP registration and legacy-plugin handling](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/console/packages/agent-providers/src/claude/claude-adapter.ts).

## 15. Creator-only approvals and revised live gate

A person's ability to instruct an agent is insufficient to approve a sponsorship action. The application must map a verified chat/platform identity to the creator's authenticated application user and reject every other actor, including another room member or an agent. Never trust a name, claimed user ID in a message, room membership, an agent-written approval message, or a native session-wide permission decision.

At the inspected source, Switch records a platform answerer as its room identity and a Gateway answerer as a user-prefixed Switch identity. It applies its addressing policy when accepting an answer. Our application must resolve that recorded identity through its verified mapping and apply the stricter creator/deal/action check before recording an approved row. Keep these identifiers opaque; different answer sources have different mappings.

The proposed Google MCP service must authenticate the calling agent, expose/dispatch only its allowlisted tools, and enforce creator-approved approval_id, deal/action scope, expiry and idempotency inside each write tool. A prompt-level allowlist or a provider's auto-approval does not satisfy this. Gmail message and brief content never selects an approval identity or a permitted tool.

The disposable operator ledger in the existing protocol probe is not the production creator-identity approval implementation. The previous unit checks do not prove wrong-identity sponsorship approvals are rejected; those tests and the actual authenticated approval path remain required.

Source for Switch's answerer recording/policy checks: [session activity service](https://github.com/sandbox-quantum/switch/blob/0d2a57ce643a57a56cd955f6a80324327558f0dd/core/switch_core/session_activity/service.py). Creator-only approval, role segregation and the application database guard are user requirements, not claims about built-in Switch enforcement.

When live setup is explicitly re-enabled, the Phase 0 gate needs:

1. Real Core health/readiness and its version/protocol declaration.
2. The custom SSE compatibility probe's mention, heartbeat, actual tool return, receipt/readback and Slack-visible reply.
3. A separately registered OpenCode identity receiving a real mention, invoking actual Switch room tools and posting a tool-derived reply visible in Slack.
4. An exact compatible OpenCode/Core/host pairing, plus evidence that the intended tool restrictions take effect.
5. A recorded list of remaining questions and user review before Phase 1.

Current state: **both real-service probes are unverified and credential setup is user-deferred**. No fixture substitutes for either gate. Open decisions are the exact runtime version pairing, enforceable per-role tool exposure, verified creator identity mapping and the unchanged earlier deployment/approval questions.
