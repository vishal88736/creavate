import { owner } from "../apps/server/src/auth.js";
import { setupSwitch } from "../apps/server/src/runtime.js";
import { closeDatabase } from "../apps/server/src/db.js";
try {
  const user = await owner();
  const result = await setupSwitch(user.id);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await closeDatabase();
}
