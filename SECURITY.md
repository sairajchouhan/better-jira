# Security Policy

## Architecture & Trust Model

`better-jira` runs **100% locally on your machine**:

- **Loopback only:** The server binds exclusively to `127.0.0.1` and enforces loopback host and same-origin checks (`localMediaRequest`) on API routes. Do **not** reverse-proxy or expose it to a network.
- **Credential storage:** Your Atlassian email and API token are stored locally at `~/.config/better-jira/instances/<name>/credentials.env` with owner-only (`0600`) file permissions.
- **No external relay or telemetry:** Credentials are sent only to the Jira Cloud origin you configure over HTTPS. There is no cloud backend or third-party telemetry.
- **Write gating:** Edits are sent to Jira only when explicitly enabled during setup (and never in `bun run dev` or with `JIRA_WRITES=off`).

## Reporting a Vulnerability

If you discover a security vulnerability (for example: credential leakage, CSRF/origin bypass, SSRF, or XSS in rendered Jira content), please **do not open a public issue**.

Instead, report it privately via GitHub's **Security Advisories** (*Security → Report a vulnerability*) on this repository. Include reproduction steps and affected versions/commits. We aim to acknowledge reports within 48 hours.
