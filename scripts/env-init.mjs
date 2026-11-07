import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
const template = readFileSync(".env.example", "utf8");
const existing = existsSync(".env");
let content = existing ? readFileSync(".env", "utf8") : template;
const present = new Set(
  [...content.matchAll(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=/gm)].map(
    (match) => match[1],
  ),
);
const missing = template.split("\n").filter((line) => {
  const key = line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1];
  return key && !present.has(key);
});
if (missing.length)
  content +=
    "\n# Newly available application settings (existing values preserved).\n" +
    missing.join("\n") +
    "\n";
for (const [key, encoding] of [
  ["APP_SECRET", "hex"],
  ["TOKEN_ENCRYPTION_KEY", "base64"],
]) {
  const blank = new RegExp("^(?:export\\s+)?" + key + "=\\s*$", "m");
  if (blank.test(content))
    content = content.replace(
      blank,
      key + "=" + randomBytes(32).toString(encoding),
    );
}
if (!existing || content !== readFileSync(".env", "utf8"))
  writeFileSync(".env", content, { flag: existing ? "w" : "wx", mode: 0o600 });
chmodSync(".env", 0o600);
console.log(
  existing
    ? "Existing .env values preserved; missing settings added and empty local keys initialized. No credential values were printed."
    : "Created ignored .env with local signing/encryption keys. Fill account settings locally; values were not printed.",
);
