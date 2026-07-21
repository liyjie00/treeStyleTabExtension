import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  root,
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: fileURLToPath(new URL("./src/background/index.ts", import.meta.url)),
        panel: fileURLToPath(new URL("./src/panel/index.html", import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background" ? "background/index.js" : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [{ src: fileURLToPath(new URL("./manifest.json", import.meta.url)), dest: "." }],
    }),
  ],
});
