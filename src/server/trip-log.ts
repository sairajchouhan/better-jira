import { appendFile } from "node:fs/promises";
import { parseTrip } from "@/shared/jira-trips";

/** `POST /api/trips`: appends the browser's trips to Jira (shared/jira-trips.ts) to `file`, one JSON line each. Answers how
 *  many it kept, as JSON, so the browser can tell this route's answer from the app page an unknown path gets. */
export function tripLog(file: () => string) {
  return async (req: Request) => {
    const body: unknown = await req.json().catch(() => null);
    if (!Array.isArray(body)) return Response.json({ error: "Send a list of trips." }, { status: 400 });
    const trips = body.map(parseTrip).filter((trip) => trip !== null);
    if (trips.length) await appendFile(file(), trips.map((trip) => `${JSON.stringify(trip)}\n`).join(""));
    return Response.json({ kept: trips.length });
  };
}
