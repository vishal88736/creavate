import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { AppError } from "@creavate/shared";
import { config, readiness } from "./config.js";
import { authenticate, creator, owner } from "./auth.js";
import { query, one, activity, closeDatabase } from "./db.js";
import {
  beginOAuth,
  finishOAuth,
  disconnectGoogle,
  slackConnection,
  slackApi,
} from "./oauth.js";
import { runtime, ingest, setupSwitch, receivePush } from "./runtime.js";
import { decideApproval } from "./workflow.js";
import { mcpHandler, configuredTools } from "./mcp.js";
export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", false);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "https://apis.google.com",
          "https://www.gstatic.com",
        ],
        connectSrc: [
          "'self'",
          ...(config.SUPABASE_URL
            ? [config.SUPABASE_URL, config.SUPABASE_URL.replace(/^http/, "ws")]
            : []),
          "https://*.googleapis.com",
        ],
        frameSrc: [
          "https://accounts.google.com",
          "https://docs.google.com",
          "https://drive.google.com",
        ],
        imgSrc: ["'self'", "data:", "https:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
  }),
);
app.use(cors({ origin: config.WEB_URL, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(
  "/api",
  rateLimit({
    windowMs: 60000,
    limit: 180,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  }),
);
app.get("/api/health", async (_req, res) => {
  let db = "not_configured";
  if (config.DATABASE_URL) {
    try {
      await query("select 1");
      db = "reachable";
    } catch {
      db = "unreachable";
    }
  }
  res.json({
    service: "creavate",
    database: db,
    configuration: readiness(),
    ingestion_mode: config.GMAIL_INGESTION_MODE,
    runtime: runtime.status(),
  });
});
app.get("/api/config", (_req, res) =>
  res.json({
    supabaseUrl: config.SUPABASE_URL || null,
    supabaseKey: config.SUPABASE_PUBLISHABLE_KEY || null,
    configuration: readiness(),
    googleOAuthConfigured: !!(
      config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
    ),
    slackOAuthConfigured: !!(
      config.SLACK_CLIENT_ID && config.SLACK_CLIENT_SECRET
    ),
    runtime: runtime.status(),
  }),
);
app.post("/api/webhooks/gmail", async (req, res) => {
  await receivePush(req.headers.authorization, req.body);
  res.sendStatus(204);
});
app.all("/mcp", mcpHandler);
const oauthCallback =
  (provider: "google" | "slack") =>
  async (req: express.Request, res: express.Response) => {
    try {
      await finishOAuth(provider, req, res);
    } catch (e) {
      const url = new URL("/", config.WEB_URL);
      url.searchParams.set("view", "profile");
      url.searchParams.set(
        "connection_error",
        e instanceof AppError
          ? e.message
          : "Authorization failed. Please reconnect.",
      );
      res.redirect(url.toString());
    }
  };
app.get("/oauth/google/callback", oauthCallback("google"));
app.get("/oauth/slack/callback", oauthCallback("slack"));
app.use("/api", authenticate);
app.get("/api/me", async (req, res) =>
  res.json({
    user: await one(
      "select id,email,slack_user_id,identity_verified_at from users where id=$1",
      [creator(req).id],
    ),
  }),
);
app.get("/api/overview", async (req, res) => {
  const uid = creator(req).id;
  const stats = await one(
    `select (select count(*)::int from emails where user_id=$1) as inquiries,(select count(*)::int from deals where user_id=$1) as deals,(select count(*)::int from approvals where user_id=$1 and status='pending' and expires_at>now()) as pending,(select count(*)::int from campaigns where user_id=$1) as campaigns,(select count(*)::int from tasks where user_id=$1 and state='completed') as completed,(select count(*)::int from tasks where user_id=$1 and state='failed') as failed`,
    [uid],
  );
  const daily = await query(
    `select to_char(d,'YYYY-MM-DD') as day,(select count(*)::int from activity_events a where a.user_id=$1 and a.created_at>=d and a.created_at<d+interval '1 day') as count from generate_series(date_trunc('day',now())-interval '6 days',date_trunc('day',now()),interval '1 day') d`,
    [uid],
  );
  res.json({ stats, daily, runtime: runtime.status() });
});
const lists: Record<string, { table: string; order: string }> = {
  inbox: { table: "emails", order: "received_at" },
  deals: { table: "deals", order: "created_at" },
  approvals: { table: "approvals", order: "created_at" },
  campaigns: { table: "campaigns", order: "created_at" },
  tasks: { table: "tasks", order: "created_at" },
  activity: { table: "activity_events", order: "created_at" },
  calls: { table: "tool_calls", order: "started_at" },
  runs: { table: "agent_runs", order: "started_at" },
};
for (const [route, def] of Object.entries(lists))
  app.get("/api/" + route, async (req, res) => {
    const uid = creator(req).id;
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .parse(req.query.offset || 0);
    const sql = ["approvals", "campaigns"].includes(route)
      ? `select a.*,d.brand,d.summary,d.red_flags,d.fee,d.currency,d.fit_score from ${def.table} a join deals d on d.id=a.deal_id and d.user_id=a.user_id where a.user_id=$1 order by a.${def.order} desc,a.id desc limit 51 offset $2`
      : `select * from ${def.table} where user_id=$1 order by ${def.order} desc,id desc limit 51 offset $2`;
    const rows = await query(sql, [uid, offset]);
    res.json({
      rows: rows.slice(0, 50),
      hasMore: rows.length > 50,
      nextOffset: offset + 50,
    });
  });
app.get("/api/profile", async (req, res) => {
  const uid = creator(req).id;
  const google =
    (
      await query(
        "select google_email,scopes,watch_expires_at,updated_at from google_connections where user_id=$1",
        [uid],
      )
    )[0] || null;
  const slack =
    (
      await query(
        "select workspace_id,slack_user_id,channel_id,bridge_id,updated_at from slack_connections where user_id=$1",
        [uid],
      )
    )[0] || null;
  const room =
    (await query("select * from switch_rooms where user_id=$1", [uid]))[0] ||
    null;
  const agents = await query(
    "select role,switch_id,name from switch_agents where user_id=$1",
    [uid],
  );
  res.json({
    google,
    slack,
    room,
    agents,
    tools: configuredTools(),
    runtime: runtime.status(),
    user: creator(req),
  });
});
app.get("/api/campaigns/:id/tasks", async (req, res) => {
  const uid = creator(req).id;
  const campaign = await one(
    "select deal_id from campaigns where id=$1 and user_id=$2",
    [z.uuid().parse(req.params.id), uid],
  );
  const executions = await query(
    "select e.result from approval_executions e join approvals a on a.id=e.approval_id where a.deal_id=$1 and a.user_id=$2 and e.state='succeeded'",
    [campaign.deal_id, uid],
  );
  res.json({
    tasks: await query(
      "select * from campaign_tasks where deal_id=$1 and user_id=$2 order by due_at nulls last,created_at",
      [campaign.deal_id, uid],
    ),
    events: executions
      .map((x) => x.result)
      .filter(
        (x) =>
          x?.start &&
          typeof x.htmlLink === "string" &&
          x.htmlLink.startsWith("https://"),
      ),
  });
});
app.post("/api/campaign-tasks/:id/complete", async (req, res) => {
  const uid = creator(req).id;
  const { completed } = z
    .object({ completed: z.boolean() })
    .strict()
    .parse(req.body);
  const result = await one(
    "update campaign_tasks set completed=$1 where id=$2 and user_id=$3 returning *",
    [completed, z.uuid().parse(req.params.id), uid],
  );
  await activity(uid, null, "creator", "campaign_task.updated", {
    id: result.id,
    completed: result.completed,
  });
  res.json(result);
});
app.post("/api/profile/google/connect", async (req, res) =>
  res.json(await beginOAuth("google", creator(req).id, res)),
);
app.post("/api/profile/slack/connect", async (req, res) =>
  res.json(await beginOAuth("slack", creator(req).id, res)),
);
app.post("/api/profile/google/disconnect", async (req, res) => {
  await runtime.stop();
  res.json(await disconnectGoogle(creator(req).id));
});
app.post("/api/profile/slack/disconnect", async (req, res) => {
  const uid = creator(req).id;
  await runtime.stop();
  const conn = await slackConnection(uid);
  await slackApi(conn.access_token, "auth.revoke");
  await query("delete from slack_connections where user_id=$1", [uid]);
  await query(
    "update users set slack_user_id=null,identity_verified_at=null where id=$1",
    [uid],
  );
  await activity(uid, null, "creator", "slack.disconnected", {});
  res.json({ connected: false });
});
app.get("/api/profile/slack/channels", async (req, res) => {
  const conn = await slackConnection(creator(req).id);
  const result = await slackApi(conn.access_token, "conversations.list", {
    types: "public_channel,private_channel",
    exclude_archived: "true",
    limit: "200",
    ...(req.query.cursor
      ? { cursor: z.string().max(1000).parse(req.query.cursor) }
      : {}),
  });
  res.json({
    channels: result.channels.map((x: any) => ({
      id: x.id,
      name: x.name,
      joined: !!x.is_member,
    })),
    nextCursor: result.response_metadata?.next_cursor || null,
  });
});
app.post("/api/profile/slack/channel", async (req, res) => {
  const uid = creator(req).id;
  const { channel_id } = z
    .object({ channel_id: z.string().regex(/^[CG][A-Z0-9]+$/) })
    .strict()
    .parse(req.body);
  const active = await one(
    "select count(*)::int as n from tasks where user_id=$1 and state not in ('completed','failed','rejected')",
    [uid],
  );
  if (active.n)
    throw new AppError(
      409,
      "Finish or reject active tasks before changing the campaign channel",
    );
  await runtime.stop();
  const conn = await slackConnection(uid);
  const info = await slackApi(conn.access_token, "conversations.info", {
    channel: channel_id,
  });
  if (!info.channel.is_member)
    throw new AppError(
      409,
      "Invite the Switch app into this Slack channel first",
    );
  await query("update slack_connections set channel_id=$1 where user_id=$2", [
    channel_id,
    uid,
  ]);
  await query("delete from switch_rooms where user_id=$1", [uid]);
  res.json({ channel_id, name: info.channel.name });
});
app.post(
  "/api/inbox/check",
  rateLimit({ windowMs: 60000, limit: 3 }),
  async (req, res) =>
    res.json(
      await ingest(
        creator(req).id,
        z
          .object({
            message_ids: z
              .array(z.string().regex(/^[a-zA-Z0-9_-]+$/))
              .max(20)
              .optional(),
          })
          .strict()
          .parse(req.body || {}).message_ids,
      ),
    ),
);
app.post("/api/approvals/:id/decide", async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const { decision } = z
    .object({ decision: z.enum(["approved", "rejected"]) })
    .strict()
    .parse(req.body);
  res.json(await decideApproval(creator(req).id, id, decision, "dashboard"));
});
app.post("/api/setup/switch", async (req, res) =>
  res.json(await setupSwitch(creator(req).id)),
);
app.post("/api/runtime/start", async (req, res) => {
  if ((await owner()).id !== creator(req).id)
    throw new AppError(403, "Creator required");
  res.json(await runtime.start());
});
app.post("/api/runtime/stop", async (req, res) => {
  if ((await owner()).id !== creator(req).id)
    throw new AppError(403, "Creator required");
  res.json(await runtime.stop());
});
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "Endpoint not found" }),
);
const web = resolve("dist/web");
if (existsSync(web)) {
  app.use(express.static(web));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve(web, "index.html")));
}
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (res.headersSent) return;
    const status =
      err instanceof AppError
        ? err.status
        : err instanceof z.ZodError
          ? 400
          : 500;
    const message =
      err instanceof AppError
        ? err.message
        : err instanceof z.ZodError
          ? "Request validation failed"
          : "The request failed. Check server logs and account connection status.";
    console.error(
      JSON.stringify({
        level: "error",
        type: err?.name || "Error",
        message: status === 500 ? "Internal server error" : message,
      }),
    );
    res.status(status).json({ error: message });
  },
);
const server = app.listen(config.PORT, "127.0.0.1", () => {
  console.log(`Creavate API listening on http://127.0.0.1:${config.PORT}`);
  if (config.ENABLE_WORKERS)
    void runtime
      .start()
      .catch((e) =>
        console.error(
          "Agent host did not start:",
          e instanceof AppError ? e.message : "Check account configuration",
        ),
      );
});
async function shutdown() {
  await runtime.stop();
  server.close();
  await closeDatabase();
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
