import { copyFile } from "node:fs/promises";
import { build } from "esbuild";
import { build as viteBuild } from "vite";
await build({
  entryPoints: ["apps/server/src/index.ts"],
  outdir: "dist/server",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  plugins: [
    {
      name: "external-vendors",
      setup(b) {
        b.onResolve({ filter: /^[^./]|^node:/ }, (a) =>
          a.path.startsWith("@creavate/")
            ? undefined
            : { path: a.path, external: true },
        );
      },
    },
  ],
});
await copyFile(
  "packages/google-mcp/src/pdf-worker.mjs",
  "dist/server/pdf-worker.mjs",
);
await viteBuild({ configFile: "apps/web/vite.config.ts" });
