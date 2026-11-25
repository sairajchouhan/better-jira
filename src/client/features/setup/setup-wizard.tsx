import { useEffect, useMemo, useState } from "react";
import { filterAvailableBoards, type AvailableBoard } from "@/shared/available-board";
import type { SetupPrompt } from "@/client/state/store";
import { Button } from "@/client/components/button";
import { TextInput } from "@/client/components/field";
import { Icon } from "@/client/components/icons";
import { GridLoader } from "@/client/components/loader";
import { SpaceIcon } from "@/client/components/space-icon";
import { Switch } from "@/client/components/switch";
import { Text } from "@/client/components/text";

type ConnectedState = {
  site: string;
  user: { id: string; name: string; avatar?: string };
  boards: AvailableBoard[];
  partial: boolean;
};

const BOARD_URL_RE = /^https?:/i;
const BOARD_ID_RE = /^\d+$/;

function SetupMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-7 shrink-0">
      <path d="M8 1A7 7 0 1 0 15 8H8Z" fill="var(--logo-ink)" />
      <rect x="10" y="1" width="5" height="5" rx="1.25" fill="var(--logo-accent)" />
    </svg>
  );
}

/** First-run browser onboarding: validates Jira credentials, lets the user pick their spaces & write mode, and hot-starts the mirror. */
export function SetupWizard({
  initial,
  onComplete,
}: {
  initial: SetupPrompt;
  onComplete: () => Promise<void> | void;
}) {
  const [site, setSite] = useState(initial.site);
  const [email, setEmail] = useState(initial.email);
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [connected, setConnected] = useState<ConnectedState | null>(null);

  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>(() => initial.boards);
  const [extraInputs, setExtraInputs] = useState<string[]>([]);
  const [writes, setWrites] = useState(initial.writes);
  const [remoteResult, setRemoteResult] = useState<{ query: string; boards: AvailableBoard[] } | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState("");

  const trimmedQuery = query.trim();
  const looksLikeUrl = BOARD_URL_RE.test(trimmedQuery);
  const looksLikeDirect = looksLikeUrl || BOARD_ID_RE.test(trimmedQuery);
  const needsRemoteSearch = Boolean(connected?.partial) && !looksLikeUrl && trimmedQuery.length >= 2;
  const remoteMatches = needsRemoteSearch && remoteResult?.query === trimmedQuery ? remoteResult.boards : null;
  const searching = needsRemoteSearch && remoteMatches === null;

  useEffect(() => {
    if (!connected || !needsRemoteSearch) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch("/api/setup/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site: connected.site, email, token, name: trimmedQuery }),
        signal: controller.signal,
      })
        .then(async (res) => {
          const body = (await res.json().catch(() => ({}))) as { boards?: AvailableBoard[] };
          if (!res.ok) throw new Error("Search failed");
          setRemoteResult({ query: trimmedQuery, boards: body.boards ?? [] });
        })
        .catch(() => {
          if (!controller.signal.aborted) setRemoteResult({ query: trimmedQuery, boards: [] });
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [connected, needsRemoteSearch, trimmedQuery, email, token]);

  const visibleBoards = useMemo(() => {
    if (!connected || looksLikeUrl) return [];
    if (remoteMatches) return remoteMatches;
    return filterAvailableBoards(connected.boards, trimmedQuery);
  }, [connected, remoteMatches, looksLikeUrl, trimmedQuery]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const totalSelected = selectedIds.length + extraInputs.length;

  const toggleBoard = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
    if (launchError) setLaunchError("");
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (connecting) return;
    setConnecting(true);
    setConnectError("");
    try {
      const response = await fetch("/api/setup/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site, email, token }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<ConnectedState> & { error?: string };
      if (!response.ok || !body.site || !body.user || !Array.isArray(body.boards)) {
        throw new Error(body.error ?? "Could not connect to Jira.");
      }
      setSite(body.site);
      setConnected({
        site: body.site,
        user: body.user,
        boards: body.boards,
        partial: Boolean(body.partial),
      });
      setSelectedIds((prev) => {
        const valid = prev.filter((id) => body.boards!.some((b) => b.id === id));
        if (valid.length) return valid;
        return body.boards!.length === 1 ? [body.boards![0]!.id] : [];
      });
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  };

  const handleComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || launching || totalSelected === 0) return;
    setLaunching(true);
    setLaunchError("");
    try {
      const response = await fetch("/api/setup/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site: connected.site,
          email,
          token,
          boards: [...selectedIds, ...extraInputs],
          writes,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) {
        throw new Error(body.error ?? "Could not save setup.");
      }
      await onComplete();
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : String(err));
      setLaunching(false);
    }
  };

  const connectedHost = connected ? new URL(connected.site).host : "";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-app px-4 py-10">
      <div className="w-full max-w-[520px]">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex items-center gap-2.5">
            <SetupMark />
            <Text as="h1" variant="title2" color="title">
              better-jira
            </Text>
          </div>
          <Text variant="small" color="muted">
            {connected
              ? "Choose which Jira spaces to keep in your sidebar."
              : "Connect your Jira Cloud account to get started."}
          </Text>
        </div>

        <div className="overflow-hidden rounded-xl border border-line bg-panel shadow-(--frame-shadow)">
          <div className="flex items-center gap-3 border-b border-line px-5 py-3 text-[12px]">
            <span className={`font-medium ${!connected ? "text-fg" : "text-fg-3"}`}>
              1. Connect Jira
            </span>
            <span className="text-fg-4">/</span>
            <span className={`font-medium ${connected ? "text-fg" : "text-fg-3"}`}>
              2. Choose spaces
            </span>
          </div>

          {!connected ? (
            <form onSubmit={handleConnect} className="flex flex-col gap-4 p-5">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="setup-site">
                  <Text variant="miniPlus" color="base">
                    Jira site
                  </Text>
                </label>
                <TextInput
                  id="setup-site"
                  autoFocus
                  placeholder="https://your-team.atlassian.net"
                  value={site}
                  onChange={(e) => {
                    setSite(e.target.value);
                    if (connectError) setConnectError("");
                  }}
                  className="w-full"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="setup-email">
                  <Text variant="miniPlus" color="base">
                    Atlassian email
                  </Text>
                </label>
                <TextInput
                  id="setup-email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (connectError) setConnectError("");
                  }}
                  className="w-full"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="setup-token">
                    <Text variant="miniPlus" color="base">
                      Jira API token
                    </Text>
                  </label>
                  <a
                    href={initial.tokenPage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[12px] text-fg-3 transition-colors hover:text-fg"
                  >
                    <span>Create API token</span>
                    <Icon name="external" size={11} />
                  </a>
                </div>
                <TextInput
                  id="setup-token"
                  type="password"
                  placeholder={initial.hasToken ? "Leave blank to keep saved token" : "Paste your Atlassian API token"}
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    if (connectError) setConnectError("");
                  }}
                  className="w-full"
                />
                <Text as="p" variant="mini" color="muted">
                  Stored locally in credentials.env with owner-only (0600) permissions. Sent only to your Jira site.
                </Text>
              </div>

              {connectError && (
                <p role="alert" className="rounded-[6px] border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-500">
                  {connectError}
                </p>
              )}

              <div className="mt-1 flex items-center justify-end">
                <Button
                  type="submit"
                  variant="primary"
                  size="medium"
                  disabled={connecting || !site.trim() || !email.trim() || (!token.trim() && !initial.hasToken)}
                  icon={connecting ? <GridLoader variant="pong" size="small" /> : undefined}
                >
                  {connecting ? "Connecting…" : "Continue"}
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleComplete} className="flex flex-col gap-4 p-5">
              <div className="flex items-center justify-between gap-2 rounded-[6px] border border-line bg-bg/50 px-3 py-2">
                <div className="min-w-0">
                  <Text as="p" variant="miniPlus" color="base" className="truncate">
                    {connected.user.name}
                  </Text>
                  <Text as="p" variant="mini" color="muted" className="truncate">
                    Connected to {connectedHost}
                  </Text>
                </div>
                <Button
                  type="button"
                  variant="borderless"
                  size="small"
                  disabled={launching}
                  onClick={() => {
                    setConnected(null);
                    setLaunchError("");
                  }}
                >
                  Change
                </Button>
              </div>

              <div className="flex flex-col gap-2">
                <div className="relative">
                  <TextInput
                    autoFocus
                    aria-label="Search spaces or paste a Jira board link or ID"
                    placeholder="Search spaces, or paste a Jira board link or ID"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className={`w-full ${searching ? "pr-8" : ""}`}
                  />
                  {searching && (
                    <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-fg-3">
                      <GridLoader variant="scope" size="small" />
                    </span>
                  )}
                </div>

                {looksLikeDirect && (
                  <div className="flex items-center justify-between gap-2 rounded-[6px] border border-line bg-bg/40 px-3 py-2">
                    <Text variant="mini" color="muted" className="truncate">
                      Add board directly: {trimmedQuery}
                    </Text>
                    <Button
                      type="button"
                      variant="secondary"
                      size="small"
                      disabled={launching}
                      onClick={() => {
                        if (BOARD_ID_RE.test(trimmedQuery)) {
                          const id = Number(trimmedQuery);
                          if (!selectedSet.has(id)) setSelectedIds((prev) => [...prev, id]);
                        } else if (!extraInputs.includes(trimmedQuery)) {
                          setExtraInputs((prev) => [...prev, trimmedQuery]);
                        }
                        setQuery("");
                        if (launchError) setLaunchError("");
                      }}
                    >
                      Select
                    </Button>
                  </div>
                )}

                {extraInputs.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {extraInputs.map((entry) => (
                      <span
                        key={entry}
                        className="inline-flex items-center gap-1 rounded-[5px] border border-line bg-sel px-2 py-0.5 text-[11px] text-fg-2"
                      >
                        <span className="max-w-[240px] truncate">{entry}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${entry}`}
                          onClick={() => setExtraInputs((prev) => prev.filter((item) => item !== entry))}
                          className="text-fg-3 hover:text-fg"
                        >
                          <Icon name="close" size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {!looksLikeUrl && (
                  <div className="overflow-hidden rounded-[6px] border border-line bg-bg/40">
                    {visibleBoards.length > 0 ? (
                      <div
                        role="listbox"
                        aria-label="Jira spaces"
                        aria-multiselectable="true"
                        className="max-h-[260px] overflow-y-auto p-1"
                      >
                        {visibleBoards.map((board) => {
                          const checked = selectedSet.has(board.id);
                          const showProjectName =
                            board.projectName && board.projectName.toLowerCase() !== board.name.toLowerCase();
                          const meta = [
                            board.projectKey,
                            showProjectName
                              ? board.projectName
                              : board.type
                                ? board.type.charAt(0).toUpperCase() + board.type.slice(1)
                                : undefined,
                            `#${board.id}`,
                          ]
                            .filter(Boolean)
                            .join(" · ");
                          return (
                            <button
                              key={board.id}
                              type="button"
                              role="option"
                              aria-selected={checked}
                              disabled={launching}
                              onClick={() => toggleBoard(board.id)}
                              className={`flex w-full items-center gap-2.5 rounded-[5px] px-2.5 py-2 text-left transition-colors hover:bg-sel ${checked ? "bg-sel/70" : ""}`}
                            >
                              <span
                                aria-hidden="true"
                                className={`grid size-4 shrink-0 place-items-center rounded-[4px] border ${
                                  checked
                                    ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--control-primary-label)]"
                                    : "border-line bg-panel"
                                }`}
                              >
                                {checked && <Icon name="check" size={11} />}
                              </span>
                              <SpaceIcon name={board.name} size={20} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium text-fg">
                                  {board.name}
                                </span>
                                <span className="block truncate text-[11px] text-fg-3">
                                  {meta}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-2 px-3 py-6 text-fg-3">
                        {searching && <GridLoader variant="scope" size="small" />}
                        <Text variant="mini" color="muted">
                          {searching
                            ? "Searching Jira…"
                            : trimmedQuery
                              ? `No spaces matching "${trimmedQuery}".`
                              : "No Jira boards found — paste a Jira board link or ID above."}
                        </Text>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 rounded-[6px] border border-line bg-bg/40 px-3 py-2.5">
                <div className="min-w-0">
                  <Text as="p" variant="miniPlus" color="base">
                    Send edits to Jira
                  </Text>
                  <Text as="p" variant="mini" color="muted">
                    {writes
                      ? `Changes save directly to ${connectedHost} as ${connected.user.name}.`
                      : "Local only: reads from Jira and saves nothing back."}
                  </Text>
                </div>
                <Switch
                  aria-label="Send edits to Jira"
                  isSelected={writes}
                  isDisabled={launching}
                  onChange={setWrites}
                >
                  <Switch.Indicator />
                </Switch>
              </div>

              {launchError && (
                <p role="alert" className="rounded-[6px] border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-500">
                  {launchError}
                </p>
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                <Text variant="mini" color="muted">
                  {totalSelected === 0
                    ? "Pick at least one space (you can add more anytime)."
                    : `${totalSelected} space${totalSelected === 1 ? "" : "s"} selected`}
                </Text>
                <Button
                  type="submit"
                  variant="primary"
                  size="medium"
                  disabled={launching || totalSelected === 0}
                  icon={launching ? <GridLoader variant="pong" size="small" /> : undefined}
                >
                  {launching ? "Starting…" : "Launch better-jira"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
