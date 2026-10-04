import { defineConfig, loadEnv, type Plugin } from "vite";
import { mintToken, rateLimited } from "./server/mint.js";

// In dev, serve the same /api/token the Vercel function serves in production, reading
// GEMINI_API_KEY (and the optional AGENT_* settings) from .env.local.
function tokenEndpoint(env: Record<string, string>): Plugin {
  return {
    name: "agent-token",
    configureServer(server) {
      server.middlewares.use("/interactions/api/token", async (req, res) => {
        res.setHeader("content-type", "application/json");
        if (rateLimited(req.socket.remoteAddress ?? "local", 30)) {
          res.statusCode = 429;
          res.end(JSON.stringify({ error: "Too many sessions." }));
          return;
        }
        try {
          const experiment = new URL(req.url ?? "", "http://x").searchParams.get("experiment") ?? "talk";
          res.end(JSON.stringify(await mintToken({ ...process.env, ...env }, experiment)));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
      });
    },
  };
}

// Served under /interactions/ (jel.design/interactions proxies to this project), so the
// build lands in dist/interactions and every asset URL carries that prefix.
export default defineConfig(({ mode }) => ({
  base: "/interactions/",
  build: { outDir: "dist/interactions", emptyOutDir: true },
  server: { port: 4100, strictPort: true, host: true },
  preview: { port: 4101 },
  plugins: [tokenEndpoint(loadEnv(mode, process.cwd(), ""))],
}));
