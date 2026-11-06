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
