import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/oauth": "http://127.0.0.1:8787",
    },
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          auth: ["@supabase/supabase-js"],
          react: ["react", "react-dom", "react-dom/client"],
          ui: [
            "@radix-ui/react-dialog",
            "@radix-ui/react-slot",
            "lucide-react",
          ],
        },
      },
    },
  },
});
