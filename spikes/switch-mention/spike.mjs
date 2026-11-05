#!/usr/bin/env node
// Disposable Phase 0 protocol probe. No product agents or Google tools.
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync, existsSync, mkdirSync, writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const credentialsPath = resolve(root, ".env.phase0-agent");
const ledgerPath = resolve(root, ".local/phase0/probe.sqlite");
const registration = {
  description: "Disposable mention and room-history probe",
  connector_type: "creavate-phase0",
  integration_profile: {
    connection_model: "always_on",
    message_exchange: true,
    pre_invocation_mediation: [],
    post_invocation_mediation: [],
    event_reporting: [],
  },
  tools: [], models: [], metadata: {}, overwrite: false,
};

export function digest(plan) {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

export class ApprovalLedger {
  constructor(path) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    }
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
        plan_json TEXT NOT NULL,
        approved_by TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS writes (
        id INTEGER PRIMARY KEY,
        approval_id TEXT NOT NULL REFERENCES approvals(id),
        action TEXT NOT NULL,
        started_at TEXT NOT NULL,
        result_json TEXT,
        error TEXT,
        UNIQUE(approval_id, action)
      );
      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  approve(id, plan, operator, confirmedDigest, now = Date.now()) {
    if (!id || !operator?.trim()) throw new Error("Approval ID and human operator are required");
    if (confirmedDigest !== digest(plan)) throw new Error("Review and confirm the exact plan digest");
    this.db.prepare(
      "INSERT INTO approvals(id,status,plan_json,approved_by,expires_at) VALUES(?,?,?,?,?)",
    ).run(id, "approved", JSON.stringify(plan), operator, now + 2 * 60 * 60 * 1000);
    return this.db.prepare(
      "SELECT id,status,approved_by,expires_at FROM approvals WHERE id=?",
    ).get(id);
  }

  requireApproved(id, plan, now = Date.now()) {
    if (!id) throw new Error("Missing recorded approval ID");
    const row = this.db.prepare("SELECT * FROM approvals WHERE id=?").get(id);
    if (!row || row.status !== "approved" || !row.approved_by) {
      throw new Error("Approval is not recorded and approved by an operator");
    }
    if (row.expires_at <= now) throw new Error("Approval expired");
    if (row.plan_json !== JSON.stringify(plan)) throw new Error("Approval scope does not match this plan");
    return row;
  }

  consume(id, plan, action, now = Date.now()) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.requireApproved(id, plan, now);
      if (!plan.writes.includes(action)) throw new Error("Action was not approved");
      const result = this.db.prepare(
        "INSERT INTO writes(approval_id,action,started_at) VALUES(?,?,?)",
      ).run(id, action, new Date(now).toISOString());
      this.db.exec("COMMIT");
      return result.lastInsertRowid;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  finish(id, result, error = null) {
    this.db.prepare("UPDATE writes SET result_json=?,error=? WHERE id=?")
      .run(JSON.stringify(result), error, id);
  }

  observe(kind, payload) {
    this.db.prepare(
      "INSERT INTO observations(kind,payload_json,created_at) VALUES(?,?,?)",
    ).run(kind, JSON.stringify(payload), new Date().toISOString());
  }

  close() { this.db.close(); }
}

export async function* parseSSE(chunks) {
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "message";
  let id = null;
  let data = [];
  let frameSize = 0;
  for await (const chunk of chunks) {
    buffer += decoder.decode(chunk, { stream: true });
    if (buffer.length > 1024 * 1024) throw new Error("SSE frame exceeded probe size limit");
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      frameSize += line.length + 1;
      if (frameSize > 1024 * 1024) throw new Error("SSE frame exceeded probe size limit");
      buffer = buffer.slice(newline + 1);
      if (line === "") {
        if (data.length) {
          yield { event, id, data: JSON.parse(data.join("\n")) };
        }
        event = "message"; id = null; data = []; frameSize = 0;
        continue;
      }
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") event = value;
      if (field === "id") id = value;
      if (field === "data") data.push(value);
    }
  }
  // A frame missing its terminating blank line is incomplete, never accepted.
}

export function eligible(frame, config) {
  const event = frame.data;
  return frame.event === "message"
    && event?.type === "message"
    && event.room_id === config.roomId
    && event.payload?.addressed === true
    && event.payload.sender === config.expectedSender
    && typeof event.payload.message_id === "string"
    && event.payload.message_id.length > 0;
}

export function historyReply(event, history, nonce) {
  if (!Array.isArray(history.events) || typeof history.has_more !== "boolean") {
    throw new Error("Actual Switch history response has an unexpected shape");
  }
  return JSON.stringify({
    probe: "creavate-phase0",
    source_message_id: event.payload.message_id,
    tool: "switch.readHistory",
    result: {
      message_count: history.events.length,
      has_more: history.has_more,
    },
    nonce,
  });
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Missing " + name);
  return value;
}

function config() {
  const url = new URL(required("SWITCH_BASE_URL"));
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("SWITCH_BASE_URL must be an origin without credentials or a path");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:"
    && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) {
    throw new Error("Use HTTPS, or HTTP on loopback for the local test");
  }
  const name = required("SWITCH_SPIKE_NAME");
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) throw new Error("Invalid Switch registry name");
  return {
    baseUrl: url.origin, name,
    agentId: process.env.SWITCH_AGENT_ID?.trim() || null,
    agentKey: process.env.SWITCH_AGENT_API_KEY?.trim() || null,
    registrationKey: process.env.SWITCH_REGISTRATION_KEY?.trim() || null,
    roomId: process.env.SWITCH_ROOM_ID?.trim() || null,
    expectedSender: process.env.SWITCH_EXPECTED_SENDER_ID?.trim() || null,
  };
}

function planFor(mode, cfg) {
  if (!["register", "listen"].includes(mode)) throw new Error("Use --mode=register or --mode=listen");
  if (mode === "listen" && (!cfg.agentId || !cfg.roomId || !cfg.expectedSender)) {
    throw new Error("Listening requires actual agent ID, room ID and expected Switch sender ID");
  }
  return {
    version: 1, mode,
    scope: {
      base_url: cfg.baseUrl, agent_name: cfg.name, agent_id: cfg.agentId,
      room_id: cfg.roomId, expected_sender_id: cfg.expectedSender,
    },
    writes: mode === "register" ? ["register"] : ["connect", "reply"],
    details: mode === "register"
      ? { request: { name: cfg.name, ...registration } }
      : {
        transport: "sse", scope: "single", filter: "all",
        maximum_replies: 1, timeout_seconds: 180,
        heartbeat: "Only while the same recorded approval is valid",
        reply: "Counts and truncation from an actual history GET; never message body instructions",
      },
  };
}

function apiUrl(cfg, path) { return new URL(path, cfg.baseUrl); }
function agentPath(cfg) { return "/agents/" + encodeURIComponent(cfg.agentId); }

async function jsonRequest(cfg, key, method, path, body) {
  if (!key) throw new Error("Missing credential for this request");
  const response = await fetch(apiUrl(cfg, path), {
    method, redirect: "error",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(method + " " + path + " returned HTTP " + response.status);
  return response.json();
}

async function mutation(ledger, approvalId, plan, action, cfg, key, path, body) {
  const attempt = ledger.consume(approvalId, plan, action);
  try {
    const result = await jsonRequest(cfg, key, "POST", path, body);
    // Only returned non-secret identifiers are retained. Never record api_key.
    ledger.finish(attempt, { id: result.id, event_id: result.event_id, ok: result.ok });
    return result;
  } catch (error) {
    ledger.finish(attempt, null, error.message);
    throw error; // A failed/ambiguous write is never retried with this grant.
  }
}

async function history(cfg) {
  if (!cfg.agentId || !cfg.roomId) throw new Error("Actual agent and room IDs are required");
  return jsonRequest(cfg, cfg.agentKey, "GET",
    agentPath(cfg) + "/rooms/" + encodeURIComponent(cfg.roomId) + "/history?limit=50");
}

async function listen(cfg, ledger, approvalId, plan) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);
  let heartbeatTimer;
  let heartbeat = null;
  let heartbeatError = null;
  let state = null;
  let replied = false;
  const connectionId = randomUUID();
  const url = apiUrl(cfg, agentPath(cfg) + "/events");
  url.search = new URLSearchParams({
    connection_id: connectionId, scope: "single", filter: "all",
    start_from: "head", rooms: cfg.roomId,
    client: "creavate-phase0", client_version: "0.0.1",
  }).toString();
  const attempt = ledger.consume(approvalId, plan, "connect");
  try {
    const response = await fetch(url, {
      headers: { Authorization: "Bearer " + cfg.agentKey, Accept: "text/event-stream" },
      redirect: "error", signal: controller.signal,
    });
    ledger.finish(attempt, { http_status: response.status });
    if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream")) {
      throw new Error("SSE open returned HTTP " + response.status + " or an unexpected content type");
    }
    for await (const frame of parseSSE(response.body)) {
      if (frame.event === "connection_state") {
        state = frame.data;
        if (!Array.isArray(state.rooms) || !state.rooms.includes(cfg.roomId)) {
          throw new Error("Server did not claim the requested room");
        }
        ledger.observe("connection_state", state);
        if (heartbeatTimer) throw new Error("Unexpected second connection_state");
        const beat = async () => {
          ledger.requireApproved(approvalId, plan);
          const body = { connection_id: connectionId };
          if (Number.isInteger(state.generation)) body.generation = state.generation;
          const result = await jsonRequest(cfg, cfg.agentKey, "POST",
            agentPath(cfg) + "/connection/beat", body);
          if (result.ok !== true || !Array.isArray(result.rooms) || !result.rooms.includes(cfg.roomId)) {
            throw new Error("Actual heartbeat response did not confirm this room");
          }
          ledger.observe("heartbeat", result);
        };
        await beat();
        heartbeatTimer = setInterval(() => {
          if (heartbeat) return;
          heartbeat = beat().catch((error) => {
            heartbeatError = error; controller.abort();
          }).finally(() => { heartbeat = null; });
        }, 2000);
        console.log(JSON.stringify({
          event: frame.event, rooms: state.rooms, generation: state.generation,
          protocol: state.protocol, server: state.server,
        }));
        continue;
      }
      if (["gap", "evicted", "refused", "room_released"].includes(frame.event)) {
        ledger.observe(frame.event, frame.data);
        throw new Error("Probe stopped on control frame: " + frame.event);
      }
      if (!state || !eligible(frame, cfg)) continue;
      ledger.observe("addressed_message", {
        message_id: frame.data.payload.message_id,
        sender: frame.data.payload.sender,
        room_id: frame.data.room_id, sequence: frame.data.sequence,
      });
      const read = await history(cfg);
      const content = historyReply(frame.data, read, randomUUID());
      ledger.observe("history_tool_return", {
        message_count: read.events.length, has_more: read.has_more,
      });
      const posted = await mutation(ledger, approvalId, plan, "reply", cfg, cfg.agentKey,
        agentPath(cfg) + "/message", { room_id: cfg.roomId, content });
      if (typeof posted.event_id !== "string" || !posted.event_id) {
        throw new Error("Actual post response contained no event ID");
      }
      const readback = await history(cfg);
      if (!Array.isArray(readback.events)) throw new Error("Unexpected readback shape");
      const matches = readback.events.filter((entry) => entry.body === content).length;
      ledger.observe("reply_readback", { event_id: posted.event_id, matches });
      if (matches !== 1) throw new Error("Posted reply was not read back exactly once");
      console.log(JSON.stringify({
        approval_id: approvalId,
        source_message_id: frame.data.payload.message_id,
        reply_event_id: posted.event_id,
        history_message_count: read.events.length,
        readback_matches: matches,
        slack_visibility: "requires independent confirmation",
      }));
      replied = true;
      break;
    }
    if (heartbeatError) throw heartbeatError;
    if (!replied) throw new Error("Stream ended without a verified addressed message and reply");
  } catch (error) {
    throw heartbeatError || error;
  } finally {
    clearTimeout(timeout);
    clearInterval(heartbeatTimer);
    controller.abort();
    if (heartbeat) await heartbeat;
  }
}

async function main() {
  if (existsSync(credentialsPath)) process.loadEnvFile(credentialsPath);
  const command = process.argv[2];
  const option = (name) => process.argv.slice(3).find((arg) => arg.startsWith("--" + name + "="))
    ?.slice(name.length + 3);
  if (command === "help" || !command) {
    console.log("Commands: plan --mode=register|listen; approve --mode=... --confirm=<digest>; register; history; listen");
    return;
  }
  const cfg = config();
  if (command === "history") {
    const result = await history(cfg);
    if (!Array.isArray(result.events)) throw new Error("Unexpected actual history shape");
    console.log(JSON.stringify({
      has_more: result.has_more,
      participants: [...new Map(result.events.map((event) =>
        [event.sender, { sender: event.sender, sender_name: event.sender_name }])).values()],
    }, null, 2));
    return;
  }
  if (!["plan", "approve", "register", "listen"].includes(command)) throw new Error("Unknown command");
  const mode = ["register", "listen"].includes(command) ? command : option("mode");
  const plan = planFor(mode, cfg);
  if (command === "plan") {
    console.log(JSON.stringify({ plan, digest: digest(plan) }, null, 2));
    return;
  }
  const approvalId = required("PHASE0_APPROVAL_ID");
  const ledger = new ApprovalLedger(ledgerPath);
  try {
    if (command === "approve") {
      const row = ledger.approve(approvalId, plan, required("PHASE0_OPERATOR"), option("confirm"));
      console.log(JSON.stringify(row));
      return;
    }
    ledger.requireApproved(approvalId, plan);
    if (command === "register") {
      if (existsSync(credentialsPath) || cfg.agentId) throw new Error("Refusing to re-register an existing probe");
      const result = await mutation(ledger, approvalId, plan, "register", cfg,
        cfg.registrationKey, "/agents", { name: cfg.name, ...registration });
      if (typeof result.id !== "string" || typeof result.api_key !== "string"
        || !result.id || !result.api_key) throw new Error("Unexpected actual registration response");
      writeFileSync(credentialsPath,
        "SWITCH_AGENT_ID=" + JSON.stringify(result.id) + "\n"
        + "SWITCH_AGENT_API_KEY=" + JSON.stringify(result.api_key) + "\n",
        { mode: 0o600, flag: "wx" });
      console.log(JSON.stringify({ agent_id: result.id, credentials_file: ".env.phase0-agent" }));
    } else {
      if (!cfg.agentKey) throw new Error("Missing actual agent credential");
      await listen(cfg, ledger, approvalId, plan);
    }
  } finally { ledger.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
