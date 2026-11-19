/** `bun run trips <name|path>`: what sent this instance's user back to Jira (src/shared/jira-trips.ts), most frequent first.
 *  Reads the instance's trips.jsonl, which its server writes; a name is `instances/<name>`, anything with a `/` a folder. */
import path from "node:path";
import { groupTrips } from "../src/shared/jira-trips";

const target = process.argv[2];
if (!target) {
  console.error("Usage: bun run trips <name>, where <name> is a folder in instances/ or a path to one.");
  process.exit(1);
}
const home = target.includes("/") ? path.resolve(target) : path.join(import.meta.dir, "..", "instances", target);
const file = Bun.file(path.join(home, "trips.jsonl"));
const groups = groupTrips((await file.exists()) ? await file.text() : "");
if (!groups.length) {
  console.log("No trips to Jira recorded yet.");
  process.exit(0);
}
const rows = [
  ["COUNT", "KIND", "JIRA PATH", "LAST SEEN"],
  ...groups.map((g) => [String(g.count), g.kind, g.path ?? "—", new Date(g.last).toLocaleString()]),
];
const widths = rows[0]!.map((_, i) => Math.max(...rows.map((row) => row[i]!.length)));
for (const row of rows) console.log(row.map((cell, i) => (i === 0 ? cell.padStart(widths[i]!) : cell.padEnd(widths[i]!))).join("  ").trimEnd());
