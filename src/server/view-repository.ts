import type { Database } from "bun:sqlite";
import { validateDraft, type SavedView } from "@/shared/saved-view-model";
import { parseGroupIds, parsePreferences } from "@/shared/view-model";

export function viewRepository(db: Database) {
  db.run(
    "CREATE TABLE IF NOT EXISTS saved_views (namespace TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(namespace,id))",
  );
  db.run("CREATE TABLE IF NOT EXISTS view_imports (namespace TEXT PRIMARY KEY)");
  const list = (ns: string): SavedView[] =>
    db
      .query<{ data: string }, [string]>(
        "SELECT data FROM saved_views WHERE namespace=? ORDER BY rowid",
      )
      .all(ns)
      .map((r) => {
        const view = JSON.parse(r.data) as SavedView;
        // A view stored before a display option existed lacks that key; read it with the option's default so later writes validate.
        // One stored before views kept hidden and collapsed groups, or their group order, has none.
        return {
          ...view,
          display: parsePreferences({ display: view.display }).display,
          hidden: parseGroupIds(view.hidden),
          collapsed: parseGroupIds(view.collapsed),
          order: parseGroupIds(view.order),
        };
      });
  const find = (ns: string, id: string) => list(ns).find((v) => v.id === id);
  const insert = (ns: string, v: SavedView) =>
    db.query("INSERT INTO saved_views VALUES (?,?,?)").run(ns, v.id, JSON.stringify(v));
  return {
    list,
    async handle(req: Request, ns: string, id?: string): Promise<Response> {
      if (
        req.method !== "GET" &&
        req.headers.get("origin") &&
        req.headers.get("origin") !== new URL(req.url).origin
      )
        return new Response("Forbidden", { status: 403 });
      try {
        if (req.method === "GET") return Response.json(list(ns));
        if (req.method === "DELETE" && id) {
          db.query("DELETE FROM saved_views WHERE namespace=? AND id=?").run(ns, id);
          return new Response(null, { status: 204 });
        }
        const body = await req.json();
        if (req.method === "POST" && id === "import") {
          if (!Array.isArray(body) || body.length > 1000) throw new Error("Invalid import");
          const views = body.map((v) => {
            if (
              typeof v.id !== "string" ||
              !/^[\w-]{1,128}$/.test(v.id) ||
              typeof v.createdAt !== "string" ||
              !Number.isFinite(Date.parse(v.createdAt)) ||
              typeof v.updatedAt !== "string" ||
              !Number.isFinite(Date.parse(v.updatedAt))
            )
              throw new Error("Invalid id");
            return {
              ...validateDraft(v),
              id: v.id,
              createdAt: v.createdAt,
              updatedAt: v.updatedAt,
            } as SavedView;
          });
          // Each legacy snapshot is imported once. Distinct browsers may hold different
          // old views; a namespace-wide marker would silently skip the second browser.
          const importKey = JSON.stringify([
            ns,
            Bun.hash(
              JSON.stringify(
                views.map(({ createdAt: _created, updatedAt: _updated, ...v }) => v),
              ),
            ).toString(),
          ]);
          db.transaction(() => {
            if (db.query("SELECT namespace FROM view_imports WHERE namespace=?").get(importKey))
              return;
            for (const v of views) if (!find(ns, v.id)) insert(ns, v);
            db.query("INSERT INTO view_imports VALUES (?)").run(importKey);
          })();
          return Response.json(list(ns));
        }
        const at = new Date().toISOString();
        if (req.method === "POST" && !id) {
          const view = {
            ...validateDraft(body),
            id: crypto.randomUUID(),
            createdAt: at,
            updatedAt: at,
          };
          insert(ns, view);
          return Response.json(view, { status: 201 });
        }
        if (req.method === "PUT" && id) {
          const old = find(ns, id);
          if (!old) return new Response("Not found", { status: 404 });
          const view = {
            ...validateDraft({ ...old, ...body }),
            id,
            createdAt: old.createdAt,
            updatedAt: at,
          };
          db.query("UPDATE saved_views SET data=? WHERE namespace=? AND id=?").run(
            JSON.stringify(view),
            ns,
            id,
          );
          return Response.json(view);
        }
        return new Response("Method not allowed", { status: 405 });
      } catch (e) {
        return Response.json(
          { error: e instanceof Error ? e.message : "Invalid view" },
          { status: 400 },
        );
      }
    },
  };
}
