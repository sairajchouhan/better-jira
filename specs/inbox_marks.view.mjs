export const title = "better-jira inbox read marks, NoAnswer retry, reload, and undo";

export const state = (v) => ({
  Mark:
    v.inFlight !== "none"
      ? `Sending ${v.inFlight} (${v.net})`
      : v.pendingRead !== "none"
        ? `Pending ${v.pendingRead} after reload`
        : v.localRead !== "none"
          ? `Stranded local ${v.localRead}`
          : v.jiraRead
            ? "Settled read"
            : "Settled unread",
  Row: v.deleted ? "Deleted (undoable)" : v.undoAvailable ? "Active (undoable)" : "Active",
});

export const step = (action) => {
  const labels = {
    SetNetworkOffline: "browser goes offline",
    SetNetworkNoAnswer: "Jira stops answering (503)",
    SetNetworkOnline: "connection returns",
    UserMarksRead: "user marks row read",
    UserDeletesRow: "user deletes row",
    SendSucceeds: "Jira accepts mark",
    SendGetsNoAnswer: "server returns 503 NoAnswer",
    SendRefusedByJira: "Jira refuses mark (502)",
    PageReload: "page reloads mid-write",
    ResumeWritesOnBoot: "boot resumes pending mark",
    UndoDelete: "user undoes delete",
    Done: "settled",
  };
  return labels[action] ?? action;
};

export const group = (v) =>
  v.inFlight === "none" && v.pendingRead === "none" && v.localRead !== "none"
    ? "error"
    : v.jiraRead
      ? "done"
      : "active";

export const colors = { active: "blue", done: "teal", error: "pink" };
