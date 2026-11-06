import { serve } from "bun";
import { watch } from "node:fs";
import index from "./index.html";
import * as mirror from "./mirror";
import { parsePreferences } from "./view-model";

const json = (body: string) => new Response(body, { headers: { "Content-Type": "application/json" } });

const server = serve({
  routes: {
    "/*": index,
    "/api/boards": () => Response.json(mirror.boards()),
    "/api/properties": () => Response.json(mirror.properties()),
    "/api/view-defaults": () => Response.json(mirror.viewDefaults()),
    "/api/view-defaults/:board": {
      PUT: async (req) => {
        if (req.headers.get("origin") && req.headers.get("origin") !== new URL(req.url).origin) return new Response("Forbidden", {status:403});
        const id = Number(req.params.board);
        if (!mirror.BOARDS.includes(id)) return new Response("Unknown board", {status:404});
        try {
          const display = parsePreferences({display:await req.json()}).display;
          mirror.saveViewDefault(id, display);
          return Response.json(display);
        } catch { return Response.json({error:"Invalid display settings"},{status:400}); }
      },
    },
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
