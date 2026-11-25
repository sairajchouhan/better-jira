export const title = "better-jira sync protocol (stale reads, takeover, lost-answer uploads)";

export const state = (v) => ({
  ReadWrite:
    v.tabLocalEdit
      ? "Local v2 pending"
      : v.readState === "in_flight"
        ? `Reading v${v.readSnapVer} (shown v${v.tabShown}, Jira v${v.jiraVer})`
        : `Shown v${v.tabShown}, Jira v${v.jiraVer}`,
  Takeover:
    v.takeoverState === "idle"
      ? "Closed tab v1 stored"
      : v.takeoverState === "read_stored"
        ? "Takeover read in flight"
        : "Takeover merged",
  Upload:
    v.uploadState === "none"
      ? "No upload"
      : `${v.uploadState}${v.fileHeld ? " (held)" : " (free)"} [${v.jiraAttachments} in Jira]`,
  SplitCreate:
    v.splitState === "none"
      ? "None"
      : `${v.splitState}${v.splitFileLost ? " (LOST)" : v.splitFileOwned ? " (owned)" : ""}`,
});

export const step = (action) => {
  const labels = {
    StartFullRead: "start full issue read",
    WriteAnswersV1: "Jira answers write v1",
    FastWriteAnswersV1: "Jira fast-returns write v1",
    CompleteFullRead: "full issue read returns",
    StartTakeoverRead: "read closed-tab changes",
    LocalEditV2: "user edits locally to v2",
    FinishTakeoverMerge: "merge takeover changes",
    PlaceAndStartUpload: "place file and start upload",
    UploadAnsweredOk: "Jira answers upload",
    UploadLostAnswer: "Jira takes file, answer lost",
    RetryLostUploadViaLedger: "retry matches file in ledger",
    UserRemovesFileFromDraft: "user removes file from draft",
    CleanerRuns: "draft-upload cleaner runs",
    StartSplitCreate: "start split create with file",
    RekeySplitCreate: "rekey split create while file uploads",
    PollOrReloadDuringSplitUpload: "poll or reload during split upload",
    FinishSplitUpload: "split file upload settles",
    Done: "settled",
  };
  return labels[action] ?? action;
};

export const group = (v) =>
  v.uploadState === "refused" || v.splitFileLost ? "error" : v.takeoverState === "done" ? "done" : "active";

export const colors = { active: "blue", done: "teal", error: "pink" };
