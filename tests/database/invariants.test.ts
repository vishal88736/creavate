// Disposable PostgreSQL only. The minimal auth schema below is a test fixture,
// not a Supabase service or a substitute for the live fresh-project gate.
import { beforeAll, afterAll, it, expect } from "vitest";
import pg from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { hash, type Manifest } from "../../packages/shared/src/index.js";
let db: pg.Pool;
let domain: typeof import("../../apps/server/src/db.js");
let flow: typeof import("../../apps/server/src/workflow.js");
const uid = randomUUID(),
  other = randomUUID();
beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url)
    throw new Error(
      "TEST_DATABASE_URL must point to an isolated, empty test PostgreSQL database.",
    );
  process.env.DATABASE_URL = url;
  process.env.DATABASE_SSL = "false";
  process.env.APP_SECRET = "test-only-signing-key-with-more-than-32-characters";
  db = new pg.Pool({ connectionString: url });
  const tables = (
    await db.query("select tablename from pg_tables where schemaname='public'")
  ).rows;
  if (tables.length)
    throw new Error("Test database is not empty; refusing to modify it.");
  await db.query(
    "create schema auth;create role anon nologin;create role authenticated nologin;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  const migrate = () =>
    promisify(execFile)(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "scripts/migrate.ts"],
      {
        env: { ...process.env, DATABASE_URL: url, DATABASE_SSL: "false" },
        timeout: 15000,
      },
    );
  await migrate();
  await migrate();
  await db.query("insert into auth.users(id) values($1),($2)", [uid, other]);
  await db.query(
    "insert into public.users(id,email) values($1,'creator@test.invalid'),($2,'other@test.invalid')",
    [uid, other],
  );
  domain = await import("../../apps/server/src/db.js");
  flow = await import("../../apps/server/src/workflow.js");
});
afterAll(async () => {
  await domain?.closeDatabase();
  await db?.end();
});
async function fixture(status = "approved") {
  const email = randomUUID(),
    deal = randomUUID(),
    task = randomUUID(),
    action = randomUUID(),
    approval = randomUUID();
  await db.query(
    "insert into emails(id,user_id,gmail_id,thread_id,sender,subject,body,received_at) values($1,$2,$3,'thread','brand@test.invalid','Test inquiry','Test-only email',now())",
    [email, uid, email],
  );
  await db.query(
    "insert into deals(id,user_id,email_id,brand,contact,deliverables,dates,red_flags,fit_score,summary,analysis) values($1,$2,$3,'Test brand','{}','[]','[]','{}',80,'Test summary','{}')",
    [deal, uid, email],
  );
  await db.query(
    "insert into tasks(id,user_id,email_id,deal_id,state) values($1,$2,$3,$4,'executing')",
    [task, uid, email, deal],
  );
  const manifest: Manifest = {
    deal_id: deal,
    task_id: task,
    actions: [
      {
        id: action,
        tool: "tasks.create",
        title: "Approved task",
        args: { title: "Deliver asset", due_at: null },
      },
    ],
  };
  await db.query(
    "insert into approvals(id,user_id,task_id,deal_id,requested_action,manifest_hash,status,decided_by,decided_at,source,verified_identity,expires_at) values($1,$2,$3,$4,$5,$6,$7,$2,now(),'dashboard',true,now()+interval '1 hour')",
    [
      approval,
      uid,
      task,
      deal,
      JSON.stringify(manifest),
      hash(manifest),
      status,
    ],
  );
  const runId = randomUUID();
  await db.query(
    "insert into agent_runs(id,user_id,task_id,agent,model) values($1,$2,$3,'campaign-agent','database-test')",
    [runId, uid, task],
  );
  return {
    email,
    deal,
    task,
    action,
    approval,
    manifest,
    ctx: {
      userId: uid,
      taskId: task,
      role: "campaign-agent" as const,
      runId,
    },
  };
}
it("allows at most one real database write under concurrent claims", async () => {
  const f = await fixture();
  const results = await Promise.allSettled([
    flow.executeAction(f.ctx, f.approval, f.action),
    flow.executeAction(f.ctx, f.approval, f.action),
  ]);
  expect(results.some((r) => r.status === "fulfilled")).toBe(true);
  expect(
    (
      await db.query(
        "select count(*)::int as n from campaign_tasks where id=$1",
        [f.action],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (
      await db.query(
        "select state from approval_executions where approval_id=$1",
        [f.approval],
      )
    ).rows[0].state,
  ).toBe("succeeded");
});
it("replays a stored real result without creating a second task", async () => {
  const f = await fixture();
  const first = await flow.executeAction(f.ctx, f.approval, f.action),
    second = await flow.executeAction(f.ctx, f.approval, f.action);
  expect(second.id).toBe(first.id);
  expect(
    (
      await db.query(
        "select count(*)::int as n from campaign_tasks where approval_id=$1",
        [f.approval],
      )
    ).rows[0].n,
  ).toBe(1);
});
it("rejects another identity without claiming an action", async () => {
  const f = await fixture();
  await expect(
    flow.executeAction({ ...f.ctx, userId: other }, f.approval, f.action),
  ).rejects.toThrow();
  expect(
    (
      await db.query("select * from approval_executions where approval_id=$1", [
        f.approval,
      ])
    ).rows,
  ).toHaveLength(0);
});
it("rejects a rejected approval without any task write", async () => {
  const f = await fixture("rejected");
  await expect(
    flow.executeAction(f.ctx, f.approval, f.action),
  ).rejects.toThrow();
  expect(
    (
      await db.query("select * from campaign_tasks where approval_id=$1", [
        f.approval,
      ])
    ).rows,
  ).toHaveLength(0);
});
it("rejects a tampered approved action manifest", async () => {
  const f = await fixture();
  f.manifest.actions[0].args.title = "Changed after approval";
  await db.query("update approvals set requested_action=$1 where id=$2", [
    JSON.stringify(f.manifest),
    f.approval,
  ]);
  await expect(flow.executeAction(f.ctx, f.approval, f.action)).rejects.toThrow(
    /modified/,
  );
});
it("rolls back illegal transitions and their activity", async () => {
  const f = await fixture();
  await expect(
    domain.transition(uid, f.task, "approved", "test"),
  ).rejects.toThrow();
  expect(
    (await db.query("select state from tasks where id=$1", [f.task])).rows[0]
      .state,
  ).toBe("executing");
  expect(
    (await db.query("select * from activity_events where task_id=$1", [f.task]))
      .rows,
  ).toHaveLength(0);
});
it("atomically enforces the final available hop", async () => {
  const f = await fixture();
  await db.query("update tasks set hop_count=5 where id=$1", [f.task]);
  const run = () =>
    domain.transaction((c) => domain.incrementHop(uid, f.task, c));
  const results = await Promise.allSettled([run(), run()]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    (await db.query("select hop_count from tasks where id=$1", [f.task]))
      .rows[0].hop_count,
  ).toBe(6);
});
it("isolates creator reads and denies browser approval mutations", async () => {
  const c = await db.connect();
  try {
    await c.query("set role authenticated");
    await c.query("select set_config('request.jwt.claim.sub',$1,false)", [
      other,
    ]);
    expect(
      (await c.query("select * from approvals where user_id=$1", [uid])).rows,
    ).toHaveLength(0);
    await expect(
      c.query("update approvals set status='approved'"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      c.query("select encrypted_tokens from google_connections"),
    ).rejects.toThrow(/permission denied/);
  } finally {
    await c.query("reset role");
    c.release();
  }
});
it("exposes only the authenticated role tools over real local MCP HTTP", async () => {
  const f = await fixture();
  const { sign } = await import("../../packages/shared/src/index.js");
  const { default: express } = await import("express");
  const { mcpHandler } = await import("../../apps/server/src/mcp.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/streamableHttp.js"
  );
  const app = express();
  app.use(express.json());
  app.all("/mcp", mcpHandler);
  app.use((e: any, _req: any, res: any, _next: any) =>
    res.status(e.status || 500).json({ error: e.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as any).port;
  const run = (
    await db.query(
      "insert into agent_runs(user_id,task_id,agent,model) values($1,$2,'brand-agent','local-test') returning id",
      [uid, f.task],
    )
  ).rows[0];
  const token = sign(
    {
      userId: uid,
      taskId: f.task,
      role: "brand-agent",
      runId: run.id,
      expires_at: Date.now() + 60000,
    },
    process.env.APP_SECRET!,
  );
  const client = new Client({
    name: "isolated-database-test",
    version: "1.0.0",
  });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
        { requestInit: { headers: { Authorization: "Bearer " + token } } },
      ),
    );
    const tools = await client.listTools();
    expect(tools.tools.some((t) => t.name === "gmail_get_thread")).toBe(true);
    expect(
      tools.tools.some(
        (t) => t.name === "campaign_execute" || t.name === "approvals_request",
      ),
    ).toBe(false);
    const taskResult: any = await client.callTool({
      name: "task_get",
      arguments: {},
    });
    expect(JSON.parse(taskResult.content[0].text).task.id).toBe(f.task);
    const denied = await client.callTool({
      name: "campaign_execute",
      arguments: { approval_id: f.approval },
    });
    expect(denied.isError).toBe(true);
    const logged = await db.query(
      "select result from tool_calls where task_id=$1 and tool='mcp.task_get'",
      [f.task],
    );
    expect(logged.rows).toHaveLength(1);
  } finally {
    await client.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

it("tracks the real migration atomically and skips it on a second run", async () => {
  const rows = (await db.query("select name,sha256 from creavate_migrations"))
    .rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].name).toBe("202611060001_creatoros.sql");
  expect(rows[0].sha256).toMatch(/^[a-f0-9]{64}$/);
});
it("deduplicates a handoff even if Switch assigned a different delivery message ID", async () => {
  const f = await fixture();
  const handoff = randomUUID();
  await db.query(
    "insert into handoffs(id,user_id,task_id,sender,recipient,kind,summary,payload) values($1,$2,$3,'brand-agent','talent-manager','analysis_ready','Test-only handoff','{}')",
    [handoff, uid, f.task],
  );
  const insert = (message: string) =>
    db.query(
      "insert into processed_events(agent,message_id,handoff_id,user_id) values('talent-manager',$1,$2,$3) on conflict do nothing returning message_id",
      [message, handoff, uid],
    );
  expect((await insert("test-message-1")).rows).toHaveLength(1);
  expect((await insert("test-message-2")).rows).toHaveLength(0);
});

it("does not consume a sourced null-kind SSE handoff before its real outbound receipt is durable", async () => {
  const f = await fixture();
  const { Runtime } = await import("../../apps/server/src/runtime.js");
  const { sign } = await import("../../packages/shared/src/index.js");
  const host = new Runtime() as any;
  host.uid = uid;
  host.roomId = "test-room";
  host.abort = new AbortController();
  const handoff = {
    id: randomUUID(),
    user_id: uid,
    task_id: f.task,
    from: "brand-agent",
    to: "talent-manager",
    kind: "analysis_ready",
    created_at: new Date().toISOString(),
  };
  await db.query(
    "insert into handoffs(id,user_id,task_id,sender,recipient,kind,summary,payload,state) values($1,$2,$3,'brand-agent','talent-manager','analysis_ready','Test-only analysis',$4,'sending')",
    [handoff.id, uid, f.task, JSON.stringify(handoff)],
  );
  // A prior delivery claim prevents a model call; this test exercises receipt
  // ordering over the real database, without a simulated provider run.
  await db.query(
    "insert into processed_events(agent,message_id,handoff_id,user_id) values('talent-manager','original-event',$1,$2)",
    [handoff.id, uid],
  );
  let finished = false;
  const received = host
    .receive("talent-manager", {
      type: "message",
      room_id: "test-room",
      payload: {
        addressed: true,
        sender: "opaque-transport-id",
        sender_kind: null,
        message_id: "original-event",
        body: "CREAVATE/1 " + sign(handoff, process.env.APP_SECRET!),
        timestamp: Date.now(),
      },
    })
    .then(() => {
      finished = true;
    });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(finished).toBe(false);
  await db.query("update handoffs set state='sent',receipt=$1 where id=$2", [
    JSON.stringify({ event_id: "original-event" }),
    handoff.id,
  ]);
  await received;
  expect(finished).toBe(true);
  expect(
    (
      await db.query(
        "select * from agent_runs where task_id=$1 and agent='talent-manager'",
        [f.task],
      )
    ).rows,
  ).toHaveLength(0);
});
it("ignores a copied signed handoff attached to another real room event", async () => {
  const f = await fixture();
  const { Runtime } = await import("../../apps/server/src/runtime.js");
  const { sign } = await import("../../packages/shared/src/index.js");
  const host = new Runtime() as any;
  host.uid = uid;
  host.roomId = "test-room";
  host.abort = new AbortController();
  const handoff = {
    id: randomUUID(),
    user_id: uid,
    task_id: f.task,
    from: "brand-agent",
    to: "talent-manager",
    kind: "analysis_ready",
    created_at: new Date().toISOString(),
  };
  await db.query(
    "insert into handoffs(id,user_id,task_id,sender,recipient,kind,summary,payload,state,receipt) values($1,$2,$3,'brand-agent','talent-manager','analysis_ready','Test-only analysis',$4,'sent',$5)",
    [
      handoff.id,
      uid,
      f.task,
      JSON.stringify(handoff),
      JSON.stringify({ event_id: "original-event" }),
    ],
  );
  await host.receive("talent-manager", {
    type: "message",
    room_id: "test-room",
    payload: {
      addressed: true,
      sender: "another-room-member",
      sender_kind: null,
      message_id: "copied-event",
      body: "CREAVATE/1 " + sign(handoff, process.env.APP_SECRET!),
      timestamp: Date.now(),
    },
  });
  expect(
    (
      await db.query("select * from processed_events where handoff_id=$1", [
        handoff.id,
      ])
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query(
        "select * from agent_runs where task_id=$1 and agent='talent-manager'",
        [f.task],
      )
    ).rows,
  ).toHaveLength(0);
});

it("blocks writes from a stopped run before claiming any action", async () => {
  const f = await fixture();
  await db.query(
    "update agent_runs set status='failed',finished_at=now() where id=$1",
    [f.ctx.runId],
  );
  await expect(flow.executeAction(f.ctx, f.approval, f.action)).rejects.toThrow(
    /no longer active/,
  );
  expect(
    (
      await db.query("select * from approval_executions where approval_id=$1", [
        f.approval,
      ])
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query("select * from campaign_tasks where approval_id=$1", [
        f.approval,
      ])
    ).rows,
  ).toHaveLength(0);
});
