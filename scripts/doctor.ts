import { spawnSync } from "node:child_process";
import { config, readiness } from "../apps/server/src/config.js";
import { query, closeDatabase } from "../apps/server/src/db.js";
const flags = readiness();
console.log("Creavate configuration (no secret values):");
for (const [name, ready] of Object.entries(flags))
  console.log(`${name}: ${ready ? "configured/enabled" : "missing/disabled"}`);
if (config.DATABASE_URL) {
  try {
    await query("select 1");
    console.log("Database: reachable");
    const tables = await query(
      "select count(*)::int as count from information_schema.tables where table_schema='public' and table_name in ('users','emails','deals','tasks','approvals','tool_calls','campaigns','activity_events')",
    );
    console.log("Required base tables:", tables[0].count + "/8");
  } catch {
    console.log("Database: unreachable or migrations not applied");
    process.exitCode = 1;
  }
}
const binary = spawnSync(config.OPENCODE_BIN, ["--version"], {
  timeout: 10000,
  encoding: "utf8",
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: process.env.LANG,
  },
});
console.log(
  "OpenCode binary:",
  binary.status === 0
    ? binary.stdout.trim().slice(0, 80)
    : "not verified (set OPENCODE_BIN to a direct compatible binary)",
);
console.log("Live Google/Slack/Switch/model gates: not run by doctor.");
await closeDatabase();
