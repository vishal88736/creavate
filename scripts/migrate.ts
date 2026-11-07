import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { database, closeDatabase } from "../apps/server/src/db.js";
const db = await database().connect();
try {
  await db.query("select pg_advisory_lock(74622140)");
  await db.query(
    "create table if not exists public.creavate_migrations(name text primary key,sha256 text not null,applied_at timestamptz not null default now())",
  );
  await db.query(
    "alter table public.creavate_migrations enable row level security;revoke all on public.creavate_migrations from anon,authenticated",
  );
  for (const file of (await readdir("supabase/migrations"))
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    const sql = await readFile("supabase/migrations/" + file, "utf8"),
      sha = createHash("sha256").update(sql).digest("hex");
    const applied = (
      await db.query(
        "select sha256 from public.creavate_migrations where name=$1",
        [file],
      )
    ).rows[0];
    if (applied) {
      if (applied.sha256 !== sha)
        throw new Error("Previously applied migration changed: " + file);
      continue;
    }
    await db.query("begin");
    try {
      await db.query(
        sql.replace(/^begin;\s*/i, "").replace(/\s*commit;\s*$/i, ""),
      );
      await db.query(
        "insert into public.creavate_migrations(name,sha256) values($1,$2)",
        [file, sha],
      );
      await db.query("commit");
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
    console.log("Applied", file);
  }
} finally {
  await db.query("select pg_advisory_unlock(74622140)");
  db.release();
  await closeDatabase();
}
