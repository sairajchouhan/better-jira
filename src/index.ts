import { serve } from "bun";
import { watch } from "node:fs";
import index from "./index.html";
import * as mirror from "./mirror";

const json = (body: string) => new Response(body, { headers: { "Content-Type": "application/json" } });

const server = serve({
  routes: {
    "/*": index,
    "/api/boards": () => Response.json(mirror.boards()),
    "/api/issues": () => json(mirror.issues()),
    "/api/issues/:key": (req) => {
      const full = mirror.issue(req.params.key);
      return full ? json(full) : Response.json({ error: "not found" }, { status: 404 });
    },
  },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
});

console.log(`better-jira on ${server.url}`);

// Production caches the frontend bundle, so exit on any source edit; `bun start` loops and rebuilds.
if (process.env.NODE_ENV === "production") watch(import.meta.dir, { recursive: true }, () => process.exit(0));
