# Phase 0 observations

Date: 2026-11-05. Status: **live gate not passed**.

| Check | What actually happened |
| --- | --- |
| Repository | Creavate main initially contained only README.md; no existing application or instructions file in scope |
| Official docs | HTTP MCP initialize returned Switch AI 1.0.0; tools/list exposed search and filesystem reads; several documentation reads completed |
| MCP setup | Direct HTTP MCP connection was used. The claude command resolved to a mise shim and began a download on --help; it was interrupted, exit 130, with zero tools installed |
| Official source | Cloned sandbox-quantum/switch; inspected SHA 0d2a57ce643a57a56cd955f6a80324327558f0dd |
| Required source areas | Read README.md, CLAUDE.md, docs index, examples listing and room/agent template references, core routes/types/policies, gateway routes, deploy Compose and .env.example |
| Docker | Client reported 29.9.2; daemon request returned permission denied on /var/run/docker.sock |
| Docker service | systemctl is-active docker returned inactive; socket was owned by root:docker; this process was not in the docker group |
| Startup attempt | sudo -n systemctl start docker failed: a password is required. No stack was started |
| User input | User chose to enable local Docker; Slack responses acknowledged the request but supplied no workspace URL, IDs, channel or credentials |
| Local probe prerequisite | Node v26.13.0 has built-in node:sqlite; in-memory query reported SQLite 3.54.0 |
| Released deployment | GitHub release listing was inspected but contained separately versioned controller prereleases; no Core image/tag/digest was declared verified |
| Private configuration | Official upstream secret generator ran; .local/upstream-switch/.env has mode 0600; generated secrets were not printed |
| Compose configuration | Official standalone file plus build override passed docker compose config --quiet |
| Planned ports | Host-side ss inspection showed no listeners on 18000, 13000, 15432 at inspection time |
| Missing-approval CLI probe | register with empty PHASE0_APPROVAL_ID exited 1 with Missing PHASE0_APPROVAL_ID before creating a ledger or making a request |
| Probe unit checks | Direct node spikes/switch-mention/spike.test.mjs reported 12 named passes; syntax check passed. These are not live-service tests |
| Switch live health | Not run against a running stack |
| Slack bridge | Not configured or verified |
| Custom registration | Not run |
| Mention -> SSE -> reply | Not run; no message or event ID is invented |
| Google / LLM / Supabase | Not configured; later phases not started |

The detailed MCP payloads and cloned code remain in ignored .local/. No credentials, private room transcripts or user IDs belong in this public observation file.

The standalone source, published docs and historical checked-in setup examples differ in places. Those discrepancies are findings to verify against the installed deployment, not grounds for guessing.

When the live probe runs, append a dated record of its actual command, server version/protocol declaration, approval ID reference (without credentials), real tool-return counts, receipt/readback result, and independent confirmation that the reply appeared in Slack. Keep raw private IDs in the ignored evidence database. Do not turn a successful parser or approval-guard unit test into a live gate pass.

## Reverification checkpoint — 2026-11-06

| Check | Actual outcome |
| --- | --- |
| User decision A | Slack selected |
| User decision B | OpenCode agents selected, superseding the Claude Code preference |
| Live setup preference | User skipped credentials/accounts; live setup remains deferred |
| Docs MCP | New initialize/search/read calls succeeded for runtime, providers, protocol, connection, events, settings, Slack and hosting; private snapshots saved under .local/discovery/2026-11-06 |
| Rechecked source | Compared targeted runtime/API/config files against official HEAD fb5780cf67465f6b9f91d77bcad411b20bde6c2b; original working-tree/deployment pin preserved |
| OpenCode source support | Session-host adapter, managed skill, MCP configuration and permission handling inspected; no live session created |
| OpenCode package inventory | mise listed OpenCode 2.2.5 as active; this is inventory evidence, not successful CLI/session execution |
| Default OpenCode launcher | Even --version ran its mise install step and timed out after 20 seconds; no successful installation or runtime-version result was established |
| Existing direct executable | Located beneath the installed package without invoking mise. Its --version check failed on log-file creation in the read-only sandbox; this is a filesystem boundary, not an observed provider compatibility failure |
| Claude Code | No mise installation listed; no authentication or Claude session attempted |
| Docker | Service still inactive at the check; no startup attempted after the user deferred live setup |
| Credential presence | Checked only configured/empty status. Slack and Switch credential fields were empty; no agent credential file was present. No values were printed |
| Model/API execution | No model invocation, Slack write, registration or Google tool call |
| Compatibility question | Switch emits the older flat OpenCode MCP/config shape; primary OpenCode V2 docs describe a different shape. Actual interoperability remains untested |
| Approval requirements | Creator mapping, denial of agents/other room members, exact deal/action binding and per-role tool enforcement recorded as requirements, not implementation claims |
| Gate | Custom SSE and OpenCode room round-trips are both pending; Phase 1 has not started |

No local test or source comparison changes the missing live evidence. The prior 12 unit checks cover only the isolated probe; they do not prove the application's creator-identity approval guard, Google integration or OpenCode runtime.


## Live setup resumed — 2026-11-06

This section supersedes the earlier deferred state; the earlier tables retain their historical outcomes.

| Check | Actual outcome |
| --- | --- |
| User direction | Keep OpenCode; resume live setup; actual Slack workspace URL received privately |
| Docker access | User enabled the daemon/group locally. A newgrp docker child successfully reported Server 29.9.3 linux x86_64; Compose 5.7.0 |
| Official build | Core and Gateway built from the inspected 0d2a57ce643a57a56cd955f6a80324327558f0dd source using the official source-build override |
| Startup | creavate-phase0 Postgres healthy; init-db exited 0; Core and Gateway started; all exposed ports bound to 127.0.0.1 |
| Core image | sha256:348ca3457afc321d60d06c81dc7a7673a608e5a9aba090a58371983c25172f77 |
| Live readiness | GET /health/ready returned status ready: database, message_listener, session_activity_listener, agent_event_listener, signal_bus and bridges all healthy |
| Gateway | GET http://127.0.0.1:13000/ returned 200; generated-admin password login returned 200, with credentials read in-process and withheld from output |
| Authenticated declaration | GET /gateway/version returned version 0.31.0; gateway-api speaks 1 / accepts 1. Agent protocol negotiation has not yet run |
| Slack setup | Authenticated GET /gateway/collaborations/setup/slack returned 200 with manifest and create_url. Exported credential-free manifest and source-matched instructions. No active Slack app/room verified yet |
| Browser automation | No browser surface was available. App creation/installation requires the user's Slack session; user requested help and received a local guide |
| OpenCode versions | Direct cached binaries returned opencode v2.2.5 and 1.19.0 with filesystem permission. The global mise launcher/configuration was not changed |
| Headless host | Inspected official controller README, source, installer and relay. Source-build dependency installation is running in ignored .local/ using pnpm 10.28.2, frozen lockfile and disabled install scripts |
| Release check | Stable controller v0.31.0 assets list a tarball and install.sh but no signature asset required by the current installer. No unsigned controller package was installed |
| Model/room execution | No model invocation, agent registration, probe grant, mention/reply or Google call has been run |
| Gate | Still open: verify Slack identity/room, custom SSE reply, OpenCode room/MCP reply and runtime/tool restrictions; Phase 1 remains unstarted |

Private responses/cookies are under ignored .local/phase0 with restricted permissions. The public docs contain no password, workspace ID, room transcript or session cookie.


### OpenCode host preparation completed

- `node .local/phase0-node-cli/node_modules/pnpm/bin/pnpm.cjs --dir .local/upstream-switch/console --filter @switch-console/agent-controller... install --frozen-lockfile --ignore-scripts --store-dir <private-project-store>` completed. The upstream install selected 6/9 projects and populated 997 packages; no install scripts or Electron application ran.
- The same pinned pnpm invocation with `--filter @switch-console/agent-controller... -r run build` passed all six selected builds. Upstream emitted source-map/plugin timing warnings.
- `--filter @switch-console/agent-controller run package` passed and produced the dependency-free CLI plus shared-host bundle. Packaged CLI `--version` returned 0.1.1; tarball SHA-256: b065b290dc456d8169d496521121b64df7ba7c53324b222ccf72f10bbe59bb62. This is a locally built artifact, not a signed upstream release.
- Started the cached direct 1.19.0 binary with `serve --hostname=127.0.0.1 --port=<free-loopback-port>`, isolated XDG configuration/data/cache/state, an empty MCP map, deny-default permissions and fresh Basic auth. Actual `/global/health` returned healthy true/version 1.19.0. `/provider` returned 200 and connected ID opencode. Stopped the process and saved only the sanitized result privately.
- The inspected process environment had no Anthropic, OpenAI, Google/Gemini or OpenCode API key. No model was invoked. Backend selection/configuration is pending user input.
- The revised fresh-configuration helper compiled, and running it against the existing generated env refused as expected; before/after bytes matched. No credential was rotated. The exported Slack manifest exactly matches the real setup response.

These results supersede the dependency-installation-in-progress row above. Controller enrollment, actual model/MCP execution, role restrictions, both room round-trips and independent Slack visibility remain unchecked.


### Model backend selected

The user selected OpenCode's built-in backend. A fresh isolated GET /provider returned connected backend opencode and default model big-pickle, listed active with input/output cost 0. Recorded `opencode/big-pickle` in private runtime-selection.json; the source adapter's parseModelId requires provider/model syntax. No model was invoked and no general availability/cost guarantee is inferred from the inventory. Slack connection and creator linking are the remaining user setup steps before the real room tests.


## Implementation resumed with offline gates — 2026-11-07

The user requested all code be implemented before connecting accounts and then selected Profile-based connections. The standalone Switch stack remains stopped. A new application-owned OpenCode host, role-scoped MCP, Google tools, approval layer and dashboard were implemented. Local validation is recorded in ../VERIFICATION.md; these code checks do not pass the unresolved Phase 0 Slack/model gate.
