import { serve, type Server } from "bun";
import { localMediaRequest } from "@/shared/attachment-media";
import index from "@/client/index.html";
import { TOKEN_PAGE } from "./jira-problem";
import {
  configuredPort,
  instanceHome,
  instanceSetupDefaults,
  isConfigured,
  loadLocalSettingsFromDisk,
  localSettings,
} from "./server-config";
import {
  connectJiraAccount,
  normalizeSiteInput,
  saveInstanceSetup,
  searchSetupBoards,
  verifySetupBoards,
} from "./setup-service";

const localOnly =
  <T extends Request>(handler: (req: T) => Response | Promise<Response>) =>
  (req: T) =>
    localMediaRequest(req) ? handler(req) : new Response("Forbidden", { status: 403 });

const sameOriginPost = (req: Request) =>
  !req.headers.get("origin") || req.headers.get("origin") === new URL(req.url).origin;

/** Starts better-jira on 127.0.0.1: either the full configured mirror, or setup mode that hot-reloads into the mirror. */
export async function startServer(): Promise<Server<undefined>> {
  try {
    instanceHome();
  } catch (error) {
    console.error(`better-jira can't start: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  loadLocalSettingsFromDisk();

  const development = process.env.NODE_ENV !== "production" && { hmr: true, console: true };
  let server!: Server<undefined>;

  if (isConfigured()) {
    const { startRuntime } = await import("./runtime");
    const routes = await startRuntime(() => server);
    server = serve({
      hostname: "127.0.0.1",
      port: configuredPort(),
      idleTimeout: 60,
      routes,
      development,
    });
    console.log(`better-jira on ${server.url}`);
    return server;
  }

  let completing = false;
  const setupPayload = () => ({
    needsSetup: true as const,
    ...instanceSetupDefaults(),
    tokenPage: TOKEN_PAGE,
  });
  const resolveToken = (given: unknown) =>
    typeof given === "string" && given.trim() ? given.trim() : (process.env.JIRA_TOKEN?.trim() ?? "");

  server = serve({
    hostname: "127.0.0.1",
    port: configuredPort(),
    idleTimeout: 60,
    routes: {
      "/*": index,
      "/api/client": localOnly(() => Response.json(setupPayload())),
      "/api/setup/status": localOnly(() => Response.json(setupPayload())),
      "/api/setup/connect": {
        POST: localOnly(async (req) => {
          if (!sameOriginPost(req)) return new Response("Forbidden", { status: 403 });
          try {
            const body = (await req.json().catch(() => ({}))) as {
              site?: unknown;
              email?: unknown;
              token?: unknown;
            };
            const result = await connectJiraAccount({
              site: typeof body.site === "string" ? body.site : "",
              email: typeof body.email === "string" ? body.email : "",
              token: resolveToken(body.token),
            });
            return Response.json(result);
          } catch (error) {
            return Response.json(
              { error: error instanceof Error ? error.message : "Could not connect to Jira." },
              { status: 422 },
            );
          }
        }),
      },
      "/api/setup/boards": {
        POST: localOnly(async (req) => {
          if (!sameOriginPost(req)) return new Response("Forbidden", { status: 403 });
          try {
            const body = (await req.json().catch(() => ({}))) as {
              site?: unknown;
              email?: unknown;
              token?: unknown;
              name?: unknown;
            };
            const result = await searchSetupBoards({
              site: typeof body.site === "string" ? body.site : "",
              email: typeof body.email === "string" ? body.email : "",
              token: resolveToken(body.token),
              name: typeof body.name === "string" ? body.name : "",
            });
            return Response.json(result);
          } catch (error) {
            return Response.json(
              { error: error instanceof Error ? error.message : "Could not search Jira boards." },
              { status: 422 },
            );
          }
        }),
      },
      "/api/setup/complete": {
        POST: localOnly(async (req) => {
          if (!sameOriginPost(req)) return new Response("Forbidden", { status: 403 });
          if (completing) {
            return Response.json({ error: "Setup is already finishing." }, { status: 409 });
          }
          completing = true;
          try {
            const body = (await req.json().catch(() => ({}))) as {
              site?: unknown;
              email?: unknown;
              token?: unknown;
              boards?: unknown;
              writes?: unknown;
            };
            const site = normalizeSiteInput(typeof body.site === "string" ? body.site : "");
            const email = typeof body.email === "string" ? body.email.trim() : "";
            const token = resolveToken(body.token);
            const rawBoards = Array.isArray(body.boards)
              ? body.boards.filter((b): b is number | string => typeof b === "number" || typeof b === "string")
              : [];
            const boards = await verifySetupBoards({ site, email, token, boards: rawBoards });
            const writes = body.writes !== false;
            await saveInstanceSetup(
              { email, token },
              { ...localSettings, site, boards, writes },
            );
            const { startRuntime } = await import("./runtime");
            const fullRoutes = await startRuntime(() => server);
            server.reload({ routes: fullRoutes });
            console.log(`[setup] configured ${new URL(site).host} (${boards.length} space${boards.length === 1 ? "" : "s"})`);
            return Response.json({ ok: true, site, boards, writes });
          } catch (error) {
            return Response.json(
              { error: error instanceof Error ? error.message : "Could not complete setup." },
              { status: 422 },
            );
          } finally {
            completing = false;
          }
        }),
      },
    },
    development,
  });
  console.log(`better-jira setup on ${server.url}`);
  return server;
}
