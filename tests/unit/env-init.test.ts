import { it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
it("initializes private keys once, adds new settings and preserves existing credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "creavate-env-test-"));
  try {
    await writeFile(
      join(directory, ".env.example"),
      "APP_SECRET=\nTOKEN_ENCRYPTION_KEY=\nGOOGLE_CLIENT_SECRET=\nENABLE_WORKERS=false\n",
    );
    const run = () =>
      promisify(execFile)(process.execPath, [resolve("scripts/env-init.mjs")], {
        cwd: directory,
      });
    const firstRun = await run();
    const first = await readFile(join(directory, ".env"), "utf8");
    const signing = first.match(/^APP_SECRET=(.+)$/m)![1];
    const encryption = first.match(/^TOKEN_ENCRYPTION_KEY=(.+)$/m)![1];
    expect(signing).toHaveLength(64);
    expect(Buffer.from(encryption, "base64")).toHaveLength(32);
    expect(firstRun.stdout).not.toContain(signing);
    expect((await stat(join(directory, ".env"))).mode & 0o777).toBe(0o600);
    await writeFile(
      join(directory, ".env"),
      first.replace(
        "GOOGLE_CLIENT_SECRET=",
        "GOOGLE_CLIENT_SECRET=test-only-existing-value",
      ),
    );
    await writeFile(
      join(directory, ".env.example"),
      first + "NEW_SETTING=default-value\n",
    );
    await run();
    const second = await readFile(join(directory, ".env"), "utf8");
    expect(second).toContain("APP_SECRET=" + signing);
    expect(second).toContain("TOKEN_ENCRYPTION_KEY=" + encryption);
    expect(second).toContain("GOOGLE_CLIENT_SECRET=test-only-existing-value");
    expect(second).toContain("NEW_SETTING=default-value");
    await run();
    expect(await readFile(join(directory, ".env"), "utf8")).toBe(second);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
