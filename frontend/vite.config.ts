import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// shared/dist fica um nível acima de frontend/ (raiz do monorepo) — sem isso o Vite bloqueia
// o import com "The request url is outside of Vite serving allow list" (spec 005).
const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    fs: { allow: [monorepoRoot] },
    // Túnel HTTPS de desenvolvimento: o Mercado Livre não aceita localhost como redirect URI do
    // OAuth (spec 012, seção 2.2), então o retorno passa por um host público do ngrok.
    allowedHosts: [".ngrok-free.app", ".ngrok-free.dev", ".ngrok.app", ".ngrok.io"],
    proxy: {
      "/api": "http://localhost:3333",
    },
  },
});
