import { instanceHome, serverConfiguration } from "./server-config";

/** Imported first by the server: a missing or broken setup stops it with what to do, not a stack trace from the mirror. */
try {
  instanceHome();
  serverConfiguration();
} catch (error) {
  console.error(`better-jira can't start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
