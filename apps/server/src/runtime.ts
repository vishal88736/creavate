import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  hash,
  AppError,
  HandoffSchema,
  unsign,
  sign,
  decrypt,
  encrypt,
  type Role,
  type RunContext,
  type Handoff,
} from "@creavate/shared";
import {
  HttpSwitchClient,
  SwitchGateway,
  type RoomMessage,
} from "@creavate/switch-adapter";
import { OpenCodeProvider } from "@creavate/agents";
import { config, required } from "./config.js";
import { query, one, transaction, audit, activity } from "./db.js";
import { owner } from "./auth.js";
import { google, slackConnection } from "./oauth.js";
import { parseGmailMessage } from "@creavate/google-mcp";
import {
  enqueue,
  handoffBody,
  failTask,
  pollSlackApprovals,
} from "./workflow.js";
export const agentNames: Record<Role, string> = {
  "talent-manager": "creavate-talent-manager",
  "brand-agent": "creavate-brand-agent",
  "campaign-agent": "creavate-campaign-agent",
};
const fields: Record<Role, [keyof typeof config, keyof typeof config]> = {
  "talent-manager": ["SWITCH_TALENT_ID", "SWITCH_TALENT_KEY"],
  "brand-agent": ["SWITCH_BRAND_ID", "SWITCH_BRAND_KEY"],
  "campaign-agent": ["SWITCH_CAMPAIGN_ID", "SWITCH_CAMPAIGN_KEY"],
};
export async function identities(uid: string) {
  const saved = await query(
    "select a.*,c.encrypted_key from switch_agents a join switch_agent_credentials c using(user_id,role) where a.user_id=$1",
    [uid],
  );
  return Object.fromEntries(
    Object.entries(fields).map(([role, [id, key]]) => {
      const existing = saved.find((x) => x.role === role);
      return [
        role,
        existing
          ? {
              id: existing.switch_id,
              key: decrypt(
                existing.encrypted_key,
                required("TOKEN_ENCRYPTION_KEY"),
                uid + ":switch:" + role,
              ) as string,
              name: existing.name,
            }
          : {
              id: config[id] as string | undefined,
              key: config[key] as string | undefined,
              name: agentNames[role as Role],
            },
      ];
    }),
  ) as Record<Role, { id?: string; key?: string; name: string }>;
}
export async function setupSwitch(uid: string) {
  const person = await owner();
  if (person.id !== uid)
    throw new AppError(403, "Only the configured creator can provision agents");
  const current = await identities(uid);
  for (const role of Object.keys(agentNames) as Role[]) {
    if (current[role].id && current[role].key) continue;
    const client = new HttpSwitchClient(
      config.SWITCH_BASE_URL,
      "",
      required("SWITCH_REGISTRATION_KEY"),
    );
    await audit(
      { userId: uid, role },
      "switch.registerAgent",
      { name: agentNames[role] },
      async () => {
        const registered = await client.registerAgent(
          agentNames[role],
          required("SWITCH_REGISTRATION_KEY"),
        );
        await transaction(async (db) => {
          await db.query(
            "insert into switch_agents(user_id,role,switch_id,name) values($1,$2,$3,$4)",
            [uid, role, registered.id, agentNames[role]],
          );
          await db.query(
            "insert into switch_agent_credentials(user_id,role,encrypted_key) values($1,$2,$3)",
            [
              uid,
              role,
              encrypt(
                registered.api_key,
                required("TOKEN_ENCRYPTION_KEY"),
                uid + ":switch:" + role,
              ),
            ],
          );
        });
        return { id: registered.id, name: agentNames[role] };
      },
    );
  }
  const agents = await identities(uid);
  const slack = await slackConnection(uid);
  if (!slack.channel_id)
    throw new AppError(
      409,
      "Select a Slack channel before connecting the room",
    );
  let roomId = config.SWITCH_ROOM_ID;
  const gateway = new SwitchGateway(
    config.SWITCH_BASE_URL,
    required("SWITCH_GATEWAY_EMAIL"),
    required("SWITCH_GATEWAY_PASSWORD"),
  );
  if (roomId) {
    const selected = await gateway.getRoom(roomId);
    if (selected.external_channel_id !== slack.channel_id)
      throw new AppError(
        409,
        "Configured Switch room belongs to another Slack channel",
      );
  }
  if (!roomId) {
    const rooms = await gateway.listRooms();
    if (!Array.isArray(rooms))
      throw new AppError(502, "Unexpected Switch room list");
    const found = rooms.find(
      (x: any) =>
        x.external_channel_id === slack.channel_id &&
        (!slack.bridge_id || x.bridge_id === slack.bridge_id),
    );
    if (found) roomId = found.id;
    else {
      if (!slack.bridge_id)
        throw new AppError(
          409,
          "Connect the Slack bridge in Switch before adopting its channel",
        );
      const result = await gateway.adoptChannel({
        name: "Creavate campaigns",
        description: "Creator sponsorship coordination",
        bridgeId: slack.bridge_id,
        channelId: slack.channel_id,
        agentIds: Object.values(agents).map((x) => x.id!),
      });
      roomId = result.id;
    }
  }
  if (!roomId) throw new AppError(502, "Switch did not return a room ID");
  await gateway.addRoomAgents(
    roomId,
    Object.values(agents).map((x) => x.id!),
  );
  await query(
    "insert into switch_rooms(user_id,switch_id,platform,channel_id) values($1,$2,'slack',$3) on conflict(user_id) do update set switch_id=excluded.switch_id,channel_id=excluded.channel_id",
    [uid, roomId, slack.channel_id],
  );
  return {
    room_id: roomId,
    agents: Object.entries(agents).map(([role, x]) => ({
      role,
      id: x.id,
      name: x.name,
    })),
  };
}
export async function ingest(uid: string, messageIds?: string[]) {
  const conn = (
    await query("select * from google_connections where user_id=$1", [uid])
  )[0];
  if (!conn)
    throw new AppError(409, "Connect Google before checking the inbox");
  const ctx = { userId: uid, role: "brand-agent" as Role };
  let page: string | undefined = messageIds
    ? undefined
    : conn.scan_page_token || undefined;
  let inserted = 0;
  for (let n = 0; n < 5; n++) {
    const listing = messageIds
      ? { messages: messageIds.map((id) => ({ id })) }
      : await audit(
          ctx,
          "gmail.listMessages",
          { lookback_days: config.GMAIL_LOOKBACK_DAYS },
          () =>
            google.listMessages(
              uid,
              `in:inbox newer_than:${config.GMAIL_LOOKBACK_DAYS}d`,
              page,
            ),
        );
    for (const m of listing.messages || []) {
      if (
        (
          await query("select 1 from emails where user_id=$1 and gmail_id=$2", [
            uid,
            m.id,
          ])
        ).length
      )
        continue;
      const raw = await audit(
        ctx,
        "gmail.getMessage",
        { message_id: m.id },
        () => google.getMessage(uid, m.id),
      );
      const mail = parseGmailMessage(raw);
      await transaction(async (db) => {
        const result = await db.query(
          "insert into emails(user_id,gmail_id,thread_id,sender,subject,body,attachments,received_at) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(user_id,gmail_id) do nothing returning id",
          [
            uid,
            mail.gmail_id,
            mail.thread_id,
            mail.sender,
            mail.subject,
            mail.body,
            JSON.stringify(mail.attachments),
            mail.received_at,
          ],
        );
        if (!result.rows.length) return;
        const task = (
          await db.query(
            "insert into tasks(user_id,email_id) values($1,$2) returning *",
            [uid, result.rows[0].id],
          )
        ).rows[0];
        await activity(
          uid,
          task.id,
          "gmail",
          "inquiry.received",
          { subject: mail.subject, email_id: result.rows[0].id },
          db,
        );
        await enqueue(
          db,
          uid,
          task.id,
          "brand-agent",
          "talent-manager",
          "inquiry",
          `New inbox message stored for sponsorship classification: ${mail.subject}.`,
        );
        inserted++;
      });
    }
    page = listing.nextPageToken;
    if (!messageIds)
      await query(
        "update google_connections set scan_page_token=$1 where user_id=$2",
        [page || null, uid],
      );
    if (!page || messageIds) break;
  }
  if (
    config.GMAIL_INGESTION_MODE === "push" &&
    (!conn.watch_expires_at ||
      new Date(conn.watch_expires_at).getTime() < Date.now() + 86400000)
  ) {
    const watch = await audit(
      ctx,
      "gmail.watch",
      { topic: required("GOOGLE_PUBSUB_TOPIC") },
      () => google.watch(uid, required("GOOGLE_PUBSUB_TOPIC")),
    );
    await query(
      "update google_connections set history_id=$1,watch_expires_at=$2 where user_id=$3",
      [watch.historyId, new Date(Number(watch.expiration)), uid],
    );
  }
  return { ingested: inserted };
}
export class Runtime {
  private abort?: AbortController;
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private inflight = new Set<Promise<void>>();
  private uid?: string;
  private roomId?: string;
  private clients = new Map<Role, HttpSwitchClient>();
  private participants = new Map<string, Role>();
  private tickPromise?: Promise<void>;
  private stopPromise?: Promise<ReturnType<Runtime["status"]>>;
  private provider = new OpenCodeProvider({
    binary: config.OPENCODE_BIN,
    model: config.OPENCODE_MODEL,
    root: ".runtime/opencode",
    timeoutSeconds: config.AGENT_TIMEOUT_SECONDS,
  });
  private announced = false;
  private lastPoll = 0;
  private lastSlackPoll = 0;
  private error?: string;
  status() {
    return {
      running: !!this.abort && !this.abort.signal.aborted,
      ready:
        this.clients.size === 3 &&
        [...this.clients.values()].every((c) => c.ready),
      error: this.error || null,
      model: config.OPENCODE_MODEL,
    };
  }
  private startPromise?: Promise<ReturnType<Runtime["status"]>>;
  async start() {
    if (this.stopPromise) await this.stopPromise;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }
  private async startInternal() {
    if (this.abort && !this.abort.signal.aborted) return this.status();
    required("APP_SECRET");
    required("TOKEN_ENCRYPTION_KEY");
    const person = await owner();
    this.uid = person.id;
    const room = (
      await query("select * from switch_rooms where user_id=$1", [person.id])
    )[0];
    this.roomId = room?.switch_id || config.SWITCH_ROOM_ID;
    if (!this.roomId)
      throw new AppError(409, "Connect the Switch room in Profile");
    const keys = await identities(person.id);
    if (Object.values(keys).some((x) => !x.id || !x.key))
      throw new AppError(409, "Provision all three Switch identities first");
    const stale = await query(
      "update agent_runs set status='failed',error='Server stopped before session completion',finished_at=now() where user_id=$1 and status='running' returning task_id,agent,id",
      [person.id],
    );
    for (const row of stale) {
      const t = await one(
        "select state from tasks where id=$1 and user_id=$2",
        [row.task_id, person.id],
      );
      if (!["awaiting_approval", "completed", "rejected"].includes(t.state))
        await failTask(
          person.id,
          row.task_id,
          row.agent,
          new Error(
            "Previous agent session was interrupted; inspect partial actions before retrying",
          ),
        );
      await query(
        "insert into handoffs(id,user_id,task_id,sender,recipient,kind,summary,payload) values(gen_random_uuid(),$1,$2,$3,'creator',$4,$5,'{}') on conflict do nothing",
        [
          person.id,
          row.task_id,
          row.agent,
          "notice:interrupted:" + row.id,
          "Recorded interrupted session for task " +
            row.task_id +
            ". Current task state: " +
            t.state +
            ". Inspect the audit log before retrying.",
        ],
      );
    }
    await query(
      "update approval_executions set state='uncertain',error='Server stopped during the action; provider reconciliation is required' where user_id=$1 and state='claimed'",
      [person.id],
    );
    const interruptedDeliveries = await query(
      "update handoffs set state='uncertain',error='Server stopped before a room receipt was persisted' where user_id=$1 and state='sending' returning task_id,sender,recipient,id",
      [person.id],
    );
    for (const delivery of interruptedDeliveries) {
      if (delivery.recipient !== "creator")
        await failTask(
          person.id,
          delivery.task_id,
          delivery.sender,
          new Error(
            "Room delivery was interrupted; reconcile the room receipt before retrying",
          ),
        );
      await activity(
        person.id,
        delivery.task_id,
        delivery.sender,
        "room.delivery_uncertain",
        {
          handoff_id: delivery.id,
          error: "Server stopped before a room receipt was persisted",
        },
      );
    }
    await query(
      "update processed_events set state='failed' where user_id=$1 and state='processing'",
      [person.id],
    );
    const controller = new AbortController();
    this.abort = controller;
    this.error = undefined;
    this.announced = false;
    for (const role of Object.keys(keys) as Role[]) {
      const saved = await one(
        "insert into switch_connections(user_id,role) values($1,$2) on conflict(user_id,role) do update set role=excluded.role returning *",
        [person.id, role],
      );
      const c = new HttpSwitchClient(
        config.SWITCH_BASE_URL,
        keys[role].id!,
        keys[role].key!,
        {
          connectionId: saved.connection_id,
          cursor: saved.cursor || undefined,
          onReady: (participants) => {
            for (const expected of Object.keys(agentNames) as Role[]) {
              const found = participants.find(
                (p) =>
                  p.type === "agent" &&
                  p.id === keys[expected].id &&
                  p.name === agentNames[expected],
              );
              if (!found)
                throw new AppError(
                  409,
                  "An agent is missing from the real room roster",
                );
              this.participants.set(found.id, expected);
            }
          },
          saveCursor: async (cursor) => {
            await query(
              "update switch_connections set cursor=$1 where user_id=$2 and role=$3",
              [cursor, person.id, role],
            );
          },
        },
      );
      this.clients.set(role, c);
      void c
        .onMessage(
          this.roomId,
          (event) => {
            const p = this.receive(role, event);
            this.inflight.add(p);
            return p.finally(() => {
              this.inflight.delete(p);
            });
          },
          controller.signal,
        )
        .catch(async (e) => {
          if (controller.signal.aborted || this.abort !== controller) return;
          this.error = e instanceof Error ? e.message : "Switch stream failed";
          await activity(person.id, null, role, "runtime.error", {
            error: this.error,
          });
          await this.stop();
        });
    }
    this.timer = setInterval(() => {
      if (this.tickPromise || controller.signal.aborted) return;
      this.tickPromise = this.tick()
        .catch(async (e) => {
          this.error = e instanceof Error ? e.message : "Worker failed";
          await activity(person.id, null, "worker", "worker.error", {
            error: this.error,
          });
        })
        .finally(() => {
          this.tickPromise = undefined;
        });
    }, 1000);
    return this.status();
  }
  async stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.stopInternal();
    try {
      return await this.stopPromise;
    } finally {
      this.stopPromise = undefined;
    }
  }
  private async stopInternal() {
    if (this.startPromise) {
      try {
        await this.startPromise;
      } catch {
        /* Start errors are already returned to the caller. */
      }
    }
    this.abort?.abort();
    if (this.timer) clearInterval(this.timer);
    await this.provider.close();
    await Promise.allSettled([
      ...(this.tickPromise ? [this.tickPromise] : []),
      ...this.inflight,
    ]);
    this.clients.clear();
    this.participants.clear();
    if (this.uid)
      await activity(this.uid, null, "worker", "agents.stopped", {});
    return this.status();
  }
  private async receive(role: Role, event: RoomMessage) {
    // The pinned protocol sets sender_kind only for platform messages. The
    // authenticated sender is established by the exact room event ID returned
    // by our persisted outbound tool call, not by parsing opaque transport IDs.
    if (!event.payload.addressed || event.payload.sender_kind === "platform")
      return;
    const match = /(?:^|\n)CREAVATE\/1 ([A-Za-z0-9_.-]+)\s*$/.exec(
      event.payload.body,
    );
    if (!match) return;
    let handoff: Handoff;
    try {
      handoff = HandoffSchema.parse(unsign(match[1], required("APP_SECRET")));
    } catch {
      // A room member cannot stop the host by posting a forged control marker.
      return;
    }
    if (
      handoff.user_id !== this.uid ||
      handoff.to !== role ||
      event.room_id !== this.roomId
    )
      return;
    // SSE can beat the HTTP response to the host. Wait for the durable receipt
    // before consuming the event; an uncertain post never authorizes a run.
    const deadline = Date.now() + 22000;
    while (true) {
      const saved = await one(
        "select * from handoffs where id=$1 and user_id=$2",
        [handoff.id, this.uid],
      );
      if (hash(saved.payload) !== hash(handoff))
        throw new AppError(403, "Handoff was not persisted");
      if (saved.receipt?.event_id) {
        if (saved.receipt.event_id !== event.payload.message_id) return;
        break;
      }
      if (saved.state !== "sending" || this.abort?.signal.aborted) return;
      if (Date.now() >= deadline)
        throw new AppError(
          503,
          "Room receipt was not persisted before the delivery deadline; reconcile before restart",
        );
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    const run = await transaction(async (db) => {
      const claimed = await db.query(
        "insert into processed_events(agent,message_id,handoff_id,user_id) values($1,$2,$3,$4) on conflict do nothing returning *",
        [role, event.payload.message_id, handoff.id, this.uid],
      );
      if (!claimed.rows.length) return undefined;
      return (
        await db.query(
          "insert into agent_runs(user_id,task_id,agent,model) values($1,$2,$3,$4) returning *",
          [this.uid, handoff.task_id, role, config.OPENCODE_MODEL],
        )
      ).rows[0];
    });
    if (!run) return;
    const context: RunContext = {
      userId: this.uid!,
      taskId: handoff.task_id,
      role,
      runId: run.id,
    };
    const token = sign(
      {
        ...context,
        expires_at: Date.now() + config.AGENT_TIMEOUT_SECONDS * 1000,
      },
      required("APP_SECRET"),
    );
    try {
      const result = await this.provider.run({
        role,
        runId: run.id,
        taskId: handoff.task_id,
        mcpUrl: config.API_URL + "/mcp",
        mcpToken: token,
        signal: AbortSignal.any([
          this.abort!.signal,
          AbortSignal.timeout(config.AGENT_TIMEOUT_SECONDS * 1000),
        ]),
      });
      const calls = await one(
        "select count(*)::int as count from tool_calls where task_id=$1 and user_id=$2 and agent=$3 and started_at>=$4 and error is null",
        [context.taskId, context.userId, role, run.started_at],
      );
      if (!calls.count)
        throw new Error("Agent finished without any successful tool call");
      const task = await one("select * from tasks where id=$1 and user_id=$2", [
        context.taskId,
        context.userId,
      ]);
      if (role === "brand-agent" && !task.deal_id && task.state !== "rejected")
        throw new Error("Brand Agent did not submit a classification");
      if (role === "campaign-agent" && task.state !== "completed")
        throw new Error("Campaign Agent did not complete the approved plan");
      if (role === "talent-manager") {
        const names = await query(
          "select tool from tool_calls where user_id=$1 and task_id=$2 and agent=$3 and started_at>=$4 and error is null",
          [context.userId, context.taskId, role, run.started_at],
        );
        if (
          !names.some((x) =>
            [
              "workflow.requestAnalysis",
              "approvals.request",
              "workflow.requestExecution",
              "workflow.report",
            ].includes(x.tool),
          )
        )
          throw new Error(
            "Talent Manager did not perform its required handoff or report",
          );
      }
      await query(
        "update agent_runs set status='succeeded',result=$1,finished_at=now() where id=$2",
        [JSON.stringify(result), run.id],
      );
      await query(
        "update processed_events set state='completed' where agent=$1 and message_id=$2",
        [role, event.payload.message_id],
      );
    } catch (e) {
      const error = e instanceof Error ? e.message : "Agent failed";
      await query(
        "update agent_runs set status='failed',error=$1,finished_at=now() where id=$2",
        [error, run.id],
      );
      await query(
        "update processed_events set state='failed' where agent=$1 and message_id=$2",
        [role, event.payload.message_id],
      );
      await failTask(context.userId, context.taskId, role, e);
      await this.notice(
        context,
        `Task ${context.taskId} failed. Recorded error: ${error}`,
      );
    }
  }
  async readHistory(ctx: RunContext) {
    if (ctx.userId !== this.uid || !this.roomId)
      throw new AppError(403, "Run is not in this creator room");
    const client = this.clients.get(ctx.role);
    if (!client) throw new AppError(503, "Room connection is unavailable");
    return client.readHistory(this.roomId);
  }
  async notice(
    ctx: Pick<RunContext, "userId" | "taskId" | "role">,
    body: string,
  ) {
    const client = this.clients.get(ctx.role);
    if (!client || !this.roomId)
      throw new AppError(503, "Switch room is not connected");
    return audit(ctx, "switch.postMessage", { body }, (callId) =>
      client.postMessage(this.roomId!, body + "\n\nTrace: " + callId),
    );
  }
  private async tick() {
    if (
      this.busy ||
      this.abort?.signal.aborted ||
      !this.uid ||
      !this.roomId ||
      !this.status().ready
    )
      return;
    this.busy = true;
    try {
      if (!this.announced) {
        this.announced = true;
        await activity(this.uid, null, "worker", "agents.connected", {
          participants: [...this.participants.entries()].map(([id, role]) => ({
            id,
            role,
          })),
        });
      }
      const pending = await query(
        "select * from handoffs where user_id=$1 and state='pending' order by created_at limit 10",
        [this.uid],
      );
      for (const row of pending) {
        if (this.abort?.signal.aborted) return;
        const claim = await query(
          "update handoffs set state='sending' where id=$1 and state='pending' returning id",
          [row.id],
        );
        if (!claim.length) continue;
        const client = this.clients.get(row.sender as Role)!;
        try {
          const receipt = await audit(
            { userId: this.uid, taskId: row.task_id, role: row.sender },
            "switch.mention",
            { handoff_id: row.id, target: row.recipient },
            (id) =>
              row.recipient === "creator"
                ? client.postMessage(
                    this.roomId!,
                    row.summary + "\n\nTrace: " + id,
                  )
                : client.mention(
                    [agentNames[row.recipient as Role]],
                    handoffBody(row, id),
                  ),
          );
          if (
            Object.values(receipt.target_statuses || {}).some(
              (s) => s === "not_permitted",
            )
          )
            throw new AppError(403, "Switch policy refused an agent handoff");
          await query(
            "update handoffs set state='sent',receipt=$1 where id=$2",
            [JSON.stringify(receipt), row.id],
          );
        } catch (e) {
          await query(
            "update handoffs set state='uncertain',error=$1 where id=$2",
            [e instanceof Error ? e.message : "Uncertain room post", row.id],
          );
          if (row.recipient !== "creator")
            await failTask(this.uid, row.task_id, row.sender, e);
          await activity(
            this.uid,
            row.task_id,
            row.sender,
            "room.delivery_uncertain",
            {
              handoff_id: row.id,
              error: e instanceof Error ? e.message : "Delivery uncertain",
            },
          );
        }
      }
      if (
        !this.abort?.signal.aborted &&
        config.GMAIL_INGESTION_MODE !== "manual" &&
        Date.now() - this.lastPoll > config.GMAIL_POLL_SECONDS * 1000
      ) {
        this.lastPoll = Date.now();
        await ingest(this.uid);
      }
      if (
        !this.abort?.signal.aborted &&
        Date.now() - this.lastSlackPoll > 60000
      ) {
        this.lastSlackPoll = Date.now();
        await pollSlackApprovals(this.uid);
      }
    } finally {
      this.busy = false;
    }
  }
}
export const runtime = new Runtime();
const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
export async function receivePush(
  authorization: string | undefined,
  body: any,
) {
  const token = authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new AppError(401, "Authenticated Pub/Sub push required");
  const { payload } = await jwtVerify(token, googleKeys, {
    audience: required("GOOGLE_PUBSUB_AUDIENCE"),
    issuer: ["https://accounts.google.com", "accounts.google.com"],
  });
  if (
    payload.email !== required("GOOGLE_PUBSUB_SERVICE_ACCOUNT") ||
    payload.email_verified !== true
  )
    throw new AppError(403, "Unexpected Pub/Sub service identity");
  const message = JSON.parse(
    Buffer.from(body?.message?.data || "", "base64").toString(),
  );
  const person = await owner();
  const conn = await one(
    "select google_email from google_connections where user_id=$1",
    [person.id],
  );
  if (message.emailAddress !== conn.google_email)
    throw new AppError(403, "Push belongs to another mailbox");
  return ingest(person.id);
}
