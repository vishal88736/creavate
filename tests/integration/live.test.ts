// These tests contact actual configured accounts. No mocks or fixture fallbacks.
import { beforeAll, afterAll, it, expect } from "vitest";
import { config, required } from "../../apps/server/src/config.js";
import { query, closeDatabase } from "../../apps/server/src/db.js";
import { owner } from "../../apps/server/src/auth.js";
import { google } from "../../apps/server/src/oauth.js";
import { identities } from "../../apps/server/src/runtime.js";
import { HttpSwitchClient } from "../../packages/switch-adapter/src/index.js";
import { audit } from "../../apps/server/src/db.js";
beforeAll(() => {
  if (process.env.RUN_LIVE_TESTS !== "true")
    throw new Error(
      "Live tests require RUN_LIVE_TESTS=true and real connected accounts.",
    );
});
afterAll(() => closeDatabase());
it("reads the real test Google profile and stores its actual tool result", async () => {
  const user = await owner();
  const result = await audit(
    { userId: user.id, role: "brand-agent" },
    "gmail.profile.integration",
    {},
    () => google.profile(user.id),
  );
  expect(result.emailAddress).toContain("@");
  const rows = await query(
    "select result from tool_calls where user_id=$1 and tool='gmail.profile.integration' order by started_at desc limit 1",
    [user.id],
  );
  expect(rows[0].result.emailAddress).toBe(result.emailAddress);
});
it("reads real room history with a registered agent credential", async () => {
  const user = await owner();
  const agents = await identities(user.id);
  const a = agents["talent-manager"];
  expect(a.id).toBeTruthy();
  const client = new HttpSwitchClient(config.SWITCH_BASE_URL, a.id!, a.key!);
  const room =
    (
      await query("select switch_id from switch_rooms where user_id=$1", [
        user.id,
      ])
    )[0]?.switch_id || required("SWITCH_ROOM_ID");
  const history = await audit(
    { userId: user.id, role: "talent-manager" },
    "switch.readHistory.integration",
    {},
    () => client.readHistory(room),
  );
  expect(Array.isArray(history.events)).toBe(true);
});
