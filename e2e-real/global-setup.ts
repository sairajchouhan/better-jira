import { SITE } from "../scripts/personal-jira";
import { PORT } from "../playwright.real.config";

/** Runs once the server listens: it must be on cloudsairaj and writable, and hold the boards' issues (its first sync). */
export default async () => {
  const at = `http://localhost:${PORT}`;
  const client = await (await fetch(`${at}/api/client`)).json();
  if (client.site !== SITE || client.writable !== true)
    throw new Error(`refusing: :${PORT} is on ${client.site} (writable ${client.writable}), not a writable ${SITE}`);
  for (let waited = 0; waited < 120_000; waited += 1000) {
    const issues = await (await fetch(`${at}/api/issues`)).json();
    if (Array.isArray(issues) && issues.length) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`:${PORT} holds no issues after 120 s: no boards are chosen, or the first sync failed`);
};
