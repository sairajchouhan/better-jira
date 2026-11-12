import { serve, type BunRequest } from "bun";
import { localMediaRequest } from "./attachment-media";
import index from "./index.html";
import * as mirror from "./mirror";
import { parsePreferences } from "./view-model";
import { serverConfiguration } from "./server-config";
import { fetchPreview } from "./link-preview";
import { applyOps, uploadAttachment } from "./jira-writes";
import { jira, JiraError, canWrite } from "./jira";
import * as inbox from "./notifications";

const json = (body: string) =>
  new Response(body, { headers: { "Content-Type": "application/json" } });

const localOnly =
  <T extends Request>(handler: (req: T) => Response | Promise<Response>) =>
  (req: T) =>
    localMediaRequest(req) ? handler(req) : new Response("Forbidden", { status: 403 });

// Field discovery, then the poll loops; the API serves only once the mirror can project issues.
await mirror.start();

const server = serve({
  hostname: "127.0.0.1",
  port: serverConfiguration().port,
  routes: {
    "/*": index,
    "/api/views": localOnly(async (req) => mirror.views.handle(req, (await mirror.clientInfo()).namespace)),
    "/api/views/:id": localOnly(async (req: BunRequest<"/api/views/:id">) => mirror.views.handle(req, (await mirror.clientInfo()).namespace, req.params.id)),
    "/api/boards": {
      GET: localOnly(() => Response.json(mirror.boards())),
      POST: localOnly(async (req) => {
        if (req.headers.get("origin") && req.headers.get("origin") !== new URL(req.url).origin)
          return new Response("Forbidden", { status: 403 });
        try {
          const { board } = await req.json().catch(() => ({}));
          return Response.json(await mirror.addBoard(typeof board === "string" ? board : ""));
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "Could not add the board." },
            { status: 422 },
          );
        }
      }),
    },
    "/api/boards/:id": {
      DELETE: localOnly(async (req: BunRequest<"/api/boards/:id">) => {
        if (req.headers.get("origin") && req.headers.get("origin") !== new URL(req.url).origin)
          return new Response("Forbidden", { status: 403 });
        try {
          await mirror.removeBoard(Number(req.params.id));
          return new Response(null, { status: 204 });
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "Could not remove the board." },
            { status: 422 },
          );
        }
      }),
    },
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
        const params = new URL(req.url).searchParams,
          category = params.get("category");
        try {
          const after = params.get("after") || undefined,
            kind = category === "direct" || category === "watching" ? category : undefined;
          // The badge counts every unread row, not just the loaded pages; without the list it falls back to them.
          const [page, unread] = await Promise.all([
            inbox.feed(kind, after),
            after || kind ? undefined : inbox.unreadGroups().catch(() => undefined),
          ]);
          return Response.json({
            ...page,
            ...(unread ? { unread } : {}),
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
          else if (body.action === "read-all") {
            // Jira marks its whole feed; the groups it changed let ⌥U's undo reach rows that were never loaded.
            const groups = (await inbox.unreadGroups()).map((g) => g.id);
            await inbox.markAllRead();
            return Response.json({ ok: true, groups });
          } else if (body.action === "seen") await inbox.clearUnseen();
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
    "/api/avatar": { GET: localOnly(mirror.avatar) },
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
        let body: { ops: unknown; board?: unknown; settle?: unknown; resend?: unknown };
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
          body.settle !== false,
          body.resend === true,
        );
        // 503: an earlier send's outcome can't be told yet; the tab sends the same ops again later.
        return Response.json(result, {
          status: result.retry ? 503 : result.error ? 422 : 200,
        });
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
            file = form.get("file"),
            client = form.get("client");
          if (!(file instanceof File))
            return Response.json({ error: "Choose a file." }, { status: 400 });
          const { id, found } = await uploadAttachment(
            req.params.key,
            file,
            typeof client === "string" && client ? client : undefined,
          );
          const mediaId = await mirror.media.identify(id);
          const issue = await jira(
            `/rest/api/3/issue/${encodeURIComponent(req.params.key)}?fields=attachment`,
          );
          const attachment = issue.fields.attachment?.find((a: any) => String(a.id) === id) ?? {
            id,
            filename: file.name,
            mimeType: file.type,
            size: file.size,
          };
          return Response.json({
            attachment: {
              id: String(attachment.id),
              name: attachment.filename,
              type: attachment.mimeType,
              size: attachment.size,
              url: `/api/issues/${encodeURIComponent(req.params.key)}/attachments/${attachment.id}`,
              mediaId,
              // Matched after a lost answer, not answered by Jira: never deleted as an orphan.
              ...(found ? { found: true } : {}),
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
    // The attachment an upload made, by the app's id for it, so a cut-off draft upload is removed by id, never guessed (R2-comments-D5).
    "/api/uploads/:client": localOnly((req: BunRequest<"/api/uploads/:client">) => {
      // No id yet: the upload was sent and its answer hasn't come (or was lost).
      const made = mirror.ledger.made(`upload:${req.params.client}`);
      return made
        ? Response.json(
            made.key ? { id: made.key, ...(made.found ? { found: true } : {}) } : { pending: true },
          )
        : Response.json({ error: "No such upload" }, { status: 404 });
    }),
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
