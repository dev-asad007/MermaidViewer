import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: {
        editor: resolve(projectRoot, "index.html"),
        guide: resolve(projectRoot, "guide.html"),
        examples: resolve(projectRoot, "examples.html"),
        privacy: resolve(projectRoot, "privacy.html"),
      },
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@codemirror") || id.includes("node_modules/@lezer")) return "code-editor";
        },
      },
    },
  },
});
