import pg, { type PoolClient } from "pg";
import { performance } from "node:perf_hooks";
import {
  AppError,
  assertTransition,
  nextHop,
  redact,
  type TaskState,
  type RunContext,
} from "@creavate/shared";
import { config, required } from "./config.js";
let pool: pg.Pool | undefined;
export function database() {
  return (pool ??= new pg.Pool({
    connectionString: required("DATABASE_URL"),
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
    ssl: config.DATABASE_SSL ? { rejectUnauthorized: true } : false,
  }));
}
export async function query<T extends pg.QueryResultRow = any>(
  sql: string,
  params: unknown[] = [],
) {
  return (await database().query<T>(sql, params)).rows;
}
export async function one<T extends pg.QueryResultRow = any>(
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const rows = await query<T>(sql, params);
  if (!rows[0]) throw new AppError(404, "Record not found");
  return rows[0];
}
export async function transaction<T>(
  fn: (db: PoolClient) => Promise<T>,
): Promise<T> {
  const db = await database().connect();
  try {
    await db.query("begin");
    const value = await fn(db);
    await db.query("commit");
    return value;
  } catch (e) {
    await db.query("rollback");
    throw e;
  } finally {
    db.release();
  }
}
export async function activity(
  userId: string,
  taskId: string | null,
  actor: string,
  kind: string,
  payload: unknown,
  db?: PoolClient,
) {
  await (db || database()).query(
    "insert into activity_events(user_id,task_id,actor,kind,payload) values($1,$2,$3,$4,$5)",
    [userId, taskId, actor, kind, JSON.stringify(redact(payload))],
  );
}
export async function transition(
  userId: string,
  taskId: string,
  to: TaskState,
  actor: string,
  error?: string,
  db?: PoolClient,
) {
  const apply = async (c: PoolClient) => {
    const row = (
      await c.query(
        "select * from tasks where id=$1 and user_id=$2 for no key update",
        [taskId, userId],
      )
    ).rows[0];
    if (!row) throw new AppError(404, "Task not found");
    assertTransition(row.state, to);
    await c.query(
      "update tasks set state=$1,error=$2,updated_at=now() where id=$3",
      [to, error || null, taskId],
    );
    await activity(
      userId,
      taskId,
      actor,
      "task." + to,
      { from: row.state, to, error },
      c,
    );
  };
  if (db) await apply(db);
  else await transaction(apply);
}
export async function incrementHop(
  userId: string,
  taskId: string,
  db: PoolClient,
) {
  const row = (
    await db.query(
      "select hop_count from tasks where id=$1 and user_id=$2 for no key update",
      [taskId, userId],
    )
  ).rows[0];
  if (!row) throw new AppError(404, "Task not found");
  const hop = nextHop(row.hop_count, config.MAX_TASK_HOPS);
  await db.query("update tasks set hop_count=$1,updated_at=now() where id=$2", [
    hop,
    taskId,
  ]);
  return hop;
}
export async function audit<T>(
  ctx: Pick<RunContext, "userId" | "role"> & { taskId?: string },
  tool: string,
  args: unknown,
  fn: (callId: string) => Promise<T>,
  approvalId?: string,
): Promise<T> {
  const row = await one(
    "insert into tool_calls(user_id,task_id,agent,tool,args,approval_id) values($1,$2,$3,$4,$5,$6) returning id",
    [
      ctx.userId,
      ctx.taskId || null,
      ctx.role,
      tool,
      JSON.stringify(redact(args)),
      approvalId || null,
    ],
  );
  const start = performance.now();
  try {
    const result = await fn(row.id);
    await query("update tool_calls set result=$1,duration=$2 where id=$3", [
      JSON.stringify(redact(result)),
      Math.round(performance.now() - start),
      row.id,
    ]);
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Tool failed";
    await query("update tool_calls set error=$1,duration=$2 where id=$3", [
      message,
      Math.round(performance.now() - start),
      row.id,
    ]);
    throw e;
  }
}
export async function ensureUser(id: string, email: string) {
  await query(
    "insert into users(id,email) values($1,$2) on conflict(id) do update set email=excluded.email",
    [id, email],
  );
}
export async function closeDatabase() {
  await pool?.end();
  pool = undefined;
}
