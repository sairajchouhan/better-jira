---- MODULE sync_protocol ----
\* Formal model of better-jira's client-server sync protocol covering:
\*   1. Stale full-record read vs write answer (src/client/state/server-data.ts fetchFull,
\*      src/client/state/local-edits.ts answeredWrites / adoptJira / mergeFull; guards commit a0a7477c).
\*   2. Multi-tab / post-reload takeover with concurrent local edits (src/client/state/local-data.ts
\*      LocalDatabase.stored / merged / mergeChanges, src/client/state/jira-sync.ts takeOverClosed;
\*      guards commit ab2de404).
\*   3. Lost-answer file upload idempotency and draft-upload cleaner (src/client/state/jira-media.ts,
\*      src/client/state/outbox.ts, src/server/jira-writes.ts uploadAttachment + writeLedger,
\*      src/client/features/issue/draft-uploads.ts cleanDraftUploads; guards commits 83c69811, 88f44ba6, 9bb41d31).

EXTENDS Integers

CONSTANTS
  BUG_STALE_READ,          \* TRUE replays pre-a0a7477c: fetchFull merges without checking writesAnswered(key) !== since
  BUG_TAKEOVER_OVERWRITE,  \* TRUE replays pre-ab2de404: takeover replaces tab state instead of 3-way merging
  BUG_LOST_UPLOAD_REFUSED, \* TRUE replays pre-83c69811: 503 NoAnswer on upload rolls back as refused instead of retrying
  BUG_CLEANER_DELETES_HELD,\* TRUE replays pre-88f44ba6/9bb41d31: cleaner deletes a held or found attachment
  BUG_FAST_WRITE_NO_BUMP,  \* TRUE replays pre-bf0c71c8: fast-returned write skips answeredWrites bump
  BUG_REKEY_DROPS_PENDING  \* TRUE replays pre-dd3719a0: split-create rekey clears createdKeys without retaining follow-up file ownership

VARIABLES
  jiraVer,          \* 0 = initial, 1 = write v1 in Jira, 2 = newer edit v2
  tabShown,         \* version shown in the active tab (0..2)
  tabLocalEdit,     \* TRUE while active tab holds an unsent local edit
  answeredCount,    \* local-edits.ts answeredWrites(key)
  readState,        \* "idle" | "in_flight" | "done"
  readSnapVer,      \* Jira version captured when fetchFull started
  readSince,        \* writesAnswered(key) captured when fetchFull started
  closedTabVer,     \* 0 = none, 1 = closed tab saved v1 to IndexedDB
  takeoverState,    \* "idle" | "read_stored" | "done"
  takeoverSnap,     \* copy read from db.stored() before concurrent local edit
  uploadState,      \* "none" | "sending" | "lost_retry" | "answered" | "found" | "refused" | "deleted"
  fileHeld,         \* TRUE while draft, document, or unsent change references the file
  jiraAttachments,  \* count of Jira attachments created for this single upload client id (0..2)
  splitState,       \* "none" | "creating" | "uploading_rekeyed" | "settled"
  splitFileOwned,   \* TRUE while localFields/fullFields protects follow-up composer file after rekey
  splitFileLost     \* TRUE if poll or reload during split upload wiped or dropped the un-uploaded file

vars == <<
  jiraVer, tabShown, tabLocalEdit, answeredCount,
  readState, readSnapVer, readSince,
  closedTabVer, takeoverState, takeoverSnap,
  uploadState, fileHeld, jiraAttachments,
  splitState, splitFileOwned, splitFileLost
>>

Init ==
  /\ jiraVer = 0
  /\ tabShown = 0
  /\ tabLocalEdit = FALSE
  /\ answeredCount = 0
  /\ readState = "idle"
  /\ readSnapVer = 0
  /\ readSince = 0
  /\ closedTabVer = 1
  /\ takeoverState = "idle"
  /\ takeoverSnap = 0
  /\ uploadState = "none"
  /\ fileHeld = FALSE
  /\ jiraAttachments = 0
  /\ splitState = "none"
  /\ splitFileOwned = FALSE
  /\ splitFileLost = FALSE

\* --- 1. Full record read vs write answer (server-data.ts fetchFull + local-edits.ts adoptJira) ---

StartFullRead ==
  /\ readState = "idle"
  /\ readState' = "in_flight"
  /\ readSnapVer' = jiraVer
  /\ readSince' = answeredCount
  /\ UNCHANGED <<jiraVer, tabShown, tabLocalEdit, answeredCount, closedTabVer, takeoverState, takeoverSnap, uploadState, fileHeld, jiraAttachments, splitState, splitFileOwned, splitFileLost>>

WriteAnswersV1 ==
  /\ jiraVer = 0
  /\ answeredCount = 0
  /\ jiraVer' = 1
  /\ answeredCount' = 1
  /\ tabShown' = IF tabLocalEdit THEN tabShown ELSE 1
  /\ UNCHANGED <<tabLocalEdit, readState, readSnapVer, readSince, closedTabVer, takeoverState, takeoverSnap, uploadState, fileHeld, jiraAttachments, splitState, splitFileOwned, splitFileLost>>

\* Fast-returned write (status / non-description fields / watcher / rank / link / weblink): answers without Jira's copy
\* (result.issue = undefined), still increments answeredWrites so an older fetchFull retries (bf0c71c8).
FastWriteAnswersV1 ==
  /\ jiraVer = 0
  /\ answeredCount = 0
  /\ jiraVer' = 1
  /\ answeredCount' = IF BUG_FAST_WRITE_NO_BUMP THEN answeredCount ELSE 1
  /\ tabShown' = IF tabLocalEdit THEN tabShown ELSE 1
  /\ UNCHANGED <<tabLocalEdit, readState, readSnapVer, readSince, closedTabVer, takeoverState, takeoverSnap, uploadState, fileHeld, jiraAttachments, splitState, splitFileOwned, splitFileLost>>

CompleteFullRead ==
  /\ readState = "in_flight"
  /\ IF ~BUG_STALE_READ /\ answeredCount # readSince
     THEN \* server-data.ts:197 retries fetchFull(key) when writesAnswered(key) moved
       /\ readSnapVer' = jiraVer
       /\ readSince' = answeredCount
       /\ readState' = "in_flight"
       /\ UNCHANGED tabShown
     ELSE
       /\ readState' = "done"
       /\ tabShown' = IF tabLocalEdit THEN tabShown ELSE readSnapVer
       /\ UNCHANGED <<readSnapVer, readSince>>
  /\ UNCHANGED <<jiraVer, tabLocalEdit, answeredCount, closedTabVer, takeoverState, takeoverSnap, uploadState, fileHeld, jiraAttachments, splitState, splitFileOwned, splitFileLost>>

\* --- 2. Multi-tab takeover with concurrent local edit (local-data.ts + jira-sync.ts) ---

StartTakeoverRead ==
  /\ takeoverState = "idle"
  /\ closedTabVer = 1
  /\ takeoverState' = "read_stored"
  /\ takeoverSnap' = closedTabVer
  /\ UNCHANGED <<jiraVer, tabShown, tabLocalEdit, answeredCount, readState, readSnapVer, readSince, closedTabVer, uploadState, fileHeld, jiraAttachments, splitState, splitFileOwned, splitFileLost>>

LocalEditV2 ==
  /\ ~tabLocalEdit
  /\ tabShown < 2
  /\ tabLocalEdit' = TRUE
  /\ tabShown' = 2
  /\ UNCHANGED <<jiraVer, answeredCount, readState, readSnapVer, readSince, closedTabVer, takeoverState, takeoverSnap, uploadState, fileHeld, jiraAttachments, splitState, splitFileOwned, splitFileLost>>

FinishTakeoverMerge ==
  /\ takeoverState = "read_stored"
  /\ takeoverState' = "done"
  /\ IF BUG_TAKEOVER_OVERWRITE
     THEN tabShown' = takeoverSnap
     ELSE tabShown' = IF tabLocalEdit THEN tabShown ELSE IF takeoverSnap > tabShown THEN takeoverSnap ELSE tabShown
  /\ UNCHANGED <<jiraVer, tabLocalEdit, answeredCount, readState, readSnapVer, readSince, closedTabVer, takeoverSnap, uploadState, fileHeld, jiraAttachments, splitState, splitFileOwned, splitFileLost>>

\* --- 3. Placed upload, lost answer retry with writeLedger, and draft-upload cleaner ---

PlaceAndStartUpload ==
  /\ uploadState = "none"
  /\ uploadState' = "sending"
  /\ fileHeld' = TRUE
  /\ UNCHANGED <<jiraVer, tabShown, tabLocalEdit, answeredCount, readState, readSnapVer, readSince, closedTabVer, takeoverState, takeoverSnap, jiraAttachments, splitState, splitFileOwned, splitFileLost>>

UploadAnsweredOk ==
  /\ uploadState = "sending"
  /\ uploadState' = "answered"
  /\ jiraAttachments' = IF jiraAttachments = 0 THEN 1 ELSE jiraAttachments
  /\ UNCHANGED <<jiraVer, tabShown, tabLocalEdit, answeredCount, readState, readSnapVer, readSince, closedTabVer, takeoverState, takeoverSnap, fileHeld, splitState, splitFileOwned, splitFileLost>>

UploadLostAnswer ==
  /\ uploadState = "sending"
  /\ jiraAttachments' = IF jiraAttachments = 0 THEN 1 ELSE jiraAttachments
  /\ uploadState' = IF BUG_LOST_UPLOAD_REFUSED THEN "refused" ELSE "lost_retry"
  /\ fileHeld' = IF BUG_LOST_UPLOAD_REFUSED THEN FALSE ELSE fileHeld
  /\ UNCHANGED <<jiraVer, tabShown, tabLocalEdit, answeredCount, readState, readSnapVer, readSince, closedTabVer, takeoverState, takeoverSnap, splitState, splitFileOwned, splitFileLost>>

RetryLostUploadViaLedger ==
  /\ uploadState = "lost_retry"
  \* writeLedger matches existing attachment (found = TRUE) without creating a duplicate in Jira
  /\ uploadState' = "found"
  /\ UNCHANGED <<jiraVer, tabShown, tabLocalEdit, answeredCount, readState, readSnapVer, readSince, closedTabVer, takeoverState, takeoverSnap, fileHeld, jiraAttachments, splitState, splitFileOwned, splitFileLost>>

UserRemovesFileFromDraft ==
  /\ fileHeld = TRUE
  /\ uploadState \in {"answered", "found"}
  /\ fileHeld' = FALSE
  /\ UNCHANGED <<jiraVer, tabShown, tabLocalEdit, answeredCount, readState, readSnapVer, readSince, closedTabVer, takeoverState, takeoverSnap, uploadState, jiraAttachments, splitState, splitFileOwned, splitFileLost>>

CleanerRuns ==
  /\ uploadState \in {"answered", "found"}
  /\ IF BUG_CLEANER_DELETES_HELD
     THEN /\ uploadState' = "deleted"
          /\ jiraAttachments' = 0
     ELSE /\ ~fileHeld
          /\ uploadState = "answered" \* found = TRUE attachments are never deleted as orphans (draft-uploads.ts:150)
          /\ uploadState' = "deleted"
          /\ jiraAttachments' = 0
  /\ UNCHANGED <<jiraVer, tabShown, tabLocalEdit, answeredCount, readState, readSnapVer, readSince, closedTabVer, takeoverState, takeoverSnap, fileHeld, splitState, splitFileOwned, splitFileLost>>

\* --- 4. Split create with composer files (outbox.ts split + jira-sync.ts rekey + local-edits.ts retainPendingOps) ---

StartSplitCreate ==
  /\ splitState = "none"
  /\ splitState' = "creating"
  /\ splitFileOwned' = TRUE
  /\ UNCHANGED <<jiraVer, tabShown, tabLocalEdit, answeredCount, readState, readSnapVer, readSince, closedTabVer, takeoverState, takeoverSnap, uploadState, fileHeld, jiraAttachments, splitFileLost>>

RekeySplitCreate ==
  /\ splitState = "creating"
  /\ splitState' = "uploading_rekeyed"
  \* retainPendingOps keeps local ownership of queued attachments/media across rekey (dd3719a0).
  /\ splitFileOwned' = IF BUG_REKEY_DROPS_PENDING THEN FALSE ELSE TRUE
  /\ UNCHANGED <<jiraVer, tabShown, tabLocalEdit, answeredCount, readState, readSnapVer, readSince, closedTabVer, takeoverState, takeoverSnap, uploadState, fileHeld, jiraAttachments, splitFileLost>>

PollOrReloadDuringSplitUpload ==
  /\ splitState = "uploading_rekeyed"
  /\ ~splitFileLost
  /\ IF splitFileOwned
     THEN UNCHANGED splitFileLost
     ELSE splitFileLost' = TRUE
  /\ UNCHANGED <<jiraVer, tabShown, tabLocalEdit, answeredCount, readState, readSnapVer, readSince, closedTabVer, takeoverState, takeoverSnap, uploadState, fileHeld, jiraAttachments, splitState, splitFileOwned>>

FinishSplitUpload ==
  /\ splitState = "uploading_rekeyed"
  /\ ~splitFileLost
  /\ splitState' = "settled"
  /\ splitFileOwned' = FALSE
  /\ UNCHANGED <<jiraVer, tabShown, tabLocalEdit, answeredCount, readState, readSnapVer, readSince, closedTabVer, takeoverState, takeoverSnap, uploadState, fileHeld, jiraAttachments, splitFileLost>>

Done ==
  /\ readState \in {"idle", "done"}
  /\ takeoverState = "done"
  /\ uploadState \in {"answered", "found", "refused", "deleted"}
  /\ splitState \in {"none", "settled"}
  /\ UNCHANGED vars

Next ==
  \/ StartFullRead
  \/ WriteAnswersV1
  \/ FastWriteAnswersV1
  \/ CompleteFullRead
  \/ StartTakeoverRead
  \/ LocalEditV2
  \/ FinishTakeoverMerge
  \/ PlaceAndStartUpload
  \/ UploadAnsweredOk
  \/ UploadLostAnswer
  \/ RetryLostUploadViaLedger
  \/ UserRemovesFileFromDraft
  \/ CleanerRuns
  \/ StartSplitCreate
  \/ RekeySplitCreate
  \/ PollOrReloadDuringSplitUpload
  \/ FinishSplitUpload
  \/ Done

\* --- Invariants (promises to users) ---

\* Guards a0a7477c + bf0c71c8: a slow full-record read overtaken by any write answer (full or fast-return) never overwrites the newer write.
NoStaleReadRegression ==
  (jiraVer > 0 /\ ~tabLocalEdit) => (tabShown >= jiraVer)

\* Guards ab2de404: taking over closed-tab storage never overwrites a concurrent edit made in this tab.
TakeoverKeepsConcurrentEdit ==
  (takeoverState = "done" /\ tabLocalEdit) => (tabShown = 2)

\* Guards 83c69811 + writeLedger: a lost-answer upload is never rolled back as refused and never duplicates in Jira.
LostAnswerNeverRefusedOrDuplicated ==
  /\ jiraAttachments <= 1
  /\ (uploadState = "refused" => jiraAttachments = 0)

\* Guards 88f44ba6 + 9bb41d31 + b472c2c4: cleaner never deletes a file still held by a draft/doc or matched as found.
CleanerNeverDeletesHeldFile ==
  (uploadState = "deleted") => (~fileHeld /\ jiraAttachments = 0)

\* Guards dd3719a0: a poll or reload after a split create rekeys never wipes or drops pending composer files.
SplitCreateKeepsPendingFiles ==
  ~splitFileLost

====
