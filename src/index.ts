import { serve, type BunRequest } from "bun";
import { localMediaRequest } from "./attachment-media";
import { watch } from "node:fs";
import index from "./index.html";
import * as mirror from "./mirror";
import { parsePreferences } from "./view-model";
import { serverConfiguration } from "./server-config";
import { fetchPreview } from "./link-preview";
import { applyOps } from "./jira-writes";
import { jira, JiraError, canWrite } from "./jira";
import * as inbox from "./notifications";

const json = (body: string) =>
  new Response(body, { headers: { "Content-Type": "application/json" } });

const localOnly =
  <T extends Request>(handler: (req: T) => Response | Promise<Response>) =>
  (req: T) =>
    localMediaRequest(req) ? handler(req) : new Response("Forbidden", { status: 403 });

const server = serve({
  hostname: "127.0.0.1",
  port: serverConfiguration().port,
  routes: {
    "/*": index,
    "/api/boards": localOnly(() => Response.json(mirror.boards())),
    // Server-sent events: one "changed" message whenever the mirror took in something new from Jira.
    "/api/events": localOnly((req) => {
      server.timeout(req, 0);
      const issue = new URL(req.url).searchParams.get("issue") || undefined,
        bytes = new TextEncoder();
      let stop = () => {};
      return new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(bytes.encode(": open\n\n"));
            stop = mirror.watch({
              issue,
              send: (kind = "changed") => {
                try {
                  stream.enqueue(bytes.encode(`data: ${kind}\n\n`));
                } catch {
                  stop();
                }
              },
            });
            req.signal.addEventListener("abort", () => stop());
          },
          cancel: () => stop(),
        }),
        { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } },
      );
    }),
    "/api/client": localOnly(async () => {
      try {
        return Response.json({
          ...(await mirror.clientInfo()),
          writable: canWrite(serverConfiguration().site),
        });
      } catch {
        return Response.json(
          { error: "Could not read your Jira account. Check setup and retry." },
          { status: 503 },
        );
      }
    }),
    "/api/inbox": {
      GET: localOnly(async (req) => {
        const category = new URL(req.url).searchParams.get("category");
        try {
          return Response.json({
            ...(await inbox.feed(
              category === "direct" || category === "watching" ? category : undefined,
            )),
            writable: canWrite(serverConfiguration().site),
          });
        } catch (e) {
          console.error("[inbox]", String(e).slice(0, 300));
          return Response.json({ error: "Could not read Jira notifications." }, { status: 503 });
        }
      }),
      POST: localOnly(async (req) => {
        if (req.headers.get("origin") && req.headers.get("origin") !== new URL(req.url).origin)
          return new Response("Forbidden", { status: 403 });
        if (!canWrite(serverConfiguration().site))
          return Response.json(
            { error: "Jira writes are disabled for this site." },
            { status: 403 },
          );
        let body: { action?: unknown; groups?: unknown };
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "Invalid request" }, { status: 400 });
        }
        const groups = Array.isArray(body.groups)
          ? body.groups.filter((g): g is string => typeof g === "string").slice(0, 50)
          : [];
        try {
          if ((body.action === "read" || body.action === "unread") && groups.length)
            await inbox.mark(groups, body.action === "read");
          else if (body.action === "read-all") await inbox.markAllRead();
          else if (body.action === "seen") await inbox.clearUnseen();
          else return Response.json({ error: "Invalid request" }, { status: 400 });
          return Response.json({ ok: true });
        } catch (e) {
          console.error("[inbox]", String(e).slice(0, 300));
          return Response.json({ error: "Jira did not update the notification." }, { status: 502 });
        }
      }),
    },
    "/api/properties": localOnly(() => Response.json(mirror.properties())),
    "/api/options": localOnly(async () => {
      try {
        return Response.json(await mirror.options());
      } catch {
        return Response.json({ error: "Could not read Jira's options." }, { status: 503 });
      }
    }),
    "/api/users": localOnly(async (req) => {
      const params = new URL(req.url).searchParams;
      try {
        return Response.json(
          await mirror.people(params.get("query") ?? "", params.get("issue") || undefined),
        );
      } catch {
        return Response.json({ error: "Could not search Jira people." }, { status: 503 });
      }
    }),
    "/api/view-defaults": localOnly(() => Response.json(mirror.viewDefaults())),
    "/api/view-defaults/:board": {
      PUT: localOnly(async (req: BunRequest<"/api/view-defaults/:board">) => {
        if (req.headers.get("origin") && req.headers.get("origin") !== new URL(req.url).origin)
          return new Response("Forbidden", { status: 403 });
        const id = Number(req.params.board);
        if (!mirror.BOARDS.includes(id)) return new Response("Unknown board", { status: 404 });
        try {
          const display = parsePreferences({ display: await req.json() }).display;
          mirror.saveViewDefault(id, display);
          return Response.json(display);
        } catch {
          return Response.json({ error: "Invalid display settings" }, { status: 400 });
        }
      }),
    },
    "/api/issues": localOnly(() => json(mirror.issues())),
    "/api/link-preview": localOnly(async (req) =>
      Response.json(await fetchPreview(new URL(req.url).searchParams.get("url") ?? "")),
    ),
    "/api/issues/:key": localOnly(async (req: BunRequest<"/api/issues/:key">) => {
      try {
        const full = await mirror.issue(req.params.key);
        return full ? json(full) : Response.json({ error: "not found" }, { status: 404 });
      } catch {
        return Response.json(
          { error: "Could not read Jira issue details. Retry the request." },
          { status: 503 },
        );
      }
    }),
    "/api/issues/:key/ops": {
      POST: localOnly(async (req: BunRequest<"/api/issues/:key/ops">) => {
        if (!canWrite(serverConfiguration().site))
          return Response.json(
            { error: "Jira writes are disabled for this site." },
            { status: 403 },
          );
        let body: { ops: unknown; board?: unknown };
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "Invalid request" }, { status: 400 });
        }
        if (!Array.isArray(body.ops))
          return Response.json({ error: "Invalid request" }, { status: 400 });
        const result = await applyOps(
          req.params.key,
          body.ops,
          typeof body.board === "number" ? body.board : undefined,
        );
        return Response.json(result, { status: result.error ? 422 : 200 });
      }),
    },
    "/api/issues/:key/attachments": {
      POST: localOnly(async (req: BunRequest<"/api/issues/:key/attachments">) => {
        if (!canWrite(serverConfiguration().site))
          return Response.json(
            { error: "Jira writes are disabled for this site." },
            { status: 403 },
          );
        try {
          const form = await req.formData(),
            file = form.get("file");
          if (!(file instanceof File))
            return Response.json({ error: "Choose a file." }, { status: 400 });
          const body = new FormData();
          body.append("file", file, file.name);
          const [attachment] = await jira(
            `/rest/api/3/issue/${encodeURIComponent(req.params.key)}/attachments`,
            { method: "POST", body },
          );
          const mediaId = await mirror.media.identify(String(attachment.id));
          const issue = await jira(
            `/rest/api/3/issue/${encodeURIComponent(req.params.key)}?fields=attachment`,
          );
          return Response.json({
            attachment: {
              id: String(attachment.id),
              name: attachment.filename,
              type: attachment.mimeType,
              size: attachment.size,
              url: `/api/issues/${encodeURIComponent(req.params.key)}/attachments/${attachment.id}`,
              mediaId,
            },
            collection: `jira-${issue.id}`,
          });
        } catch (e) {
          return Response.json(
            { error: e instanceof JiraError ? e.reason : "Could not upload attachment." },
            { status: 422 },
          );
        }
      }),
    },
    "/api/issues/:key/media/:mediaId": localOnly(
      async (req: BunRequest<"/api/issues/:key/media/:mediaId">) => {
        if (req.method !== "GET")
          return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
        try {
          const attachment = await mirror.media.resolve(req.params.key, req.params.mediaId);
          return attachment
            ? Response.json(attachment, { headers: { "Cache-Control": "private, no-store" } })
            : Response.json({ error: "Media not found" }, { status: 404 });
        } catch {
          return Response.json(
            { error: "Could not resolve media. Retry the request." },
            { status: 503 },
          );
        }
      },
    ),
    "/api/issues/:key/attachments/:id": localOnly(
      async (req: BunRequest<"/api/issues/:key/attachments/:id">) => {
        try {
          return await mirror.media.content(req, req.params.key, req.params.id);
        } catch {
          return Response.json(
            { error: "Could not load attachment. Retry the request." },
            { status: 503 },
          );
        }
      },
    ),
  },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
});

console.log(`better-jira on ${server.url}`);

// Production caches the frontend bundle, so exit on any source edit; `bun start` loops and rebuilds.
if (process.env.NODE_ENV === "production")
  watch(import.meta.dir, { recursive: true }, () => process.exit(0));
