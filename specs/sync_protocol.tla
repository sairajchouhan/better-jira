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
  BUG_CLEANER_DELETES_HELD \* TRUE replays pre-88f44ba6/9bb41d31: cleaner deletes a held or found attachment

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
  jiraAttachments   \* count of Jira attachments created for this single upload client id (0..2)

vars == <<
  jiraVer, tabShown, tabLocalEdit, answeredCount,
  readState, readSnapVer, readSince,
  closedTabVer, takeoverState, takeoverSnap,
  uploadState, fileHeld, jiraAttachments
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

\* --- 1. Full record read vs write answer (server-data.ts fetchFull + local-edits.ts adoptJira) ---

StartFullRead ==
  /\ readState = "idle"
  /\ readState' = "in_flight"
  /\ readSnapVer' = jiraVer
  /\ readSince' = answeredCount
  /\ UNCHANGED <<jiraVer, tabShown, tabLocalEdit, answeredCount, closedTabVer, takeoverState, takeoverSnap, uploadState, fileHeld, jiraAttachments>>

WriteAnswersV1 ==
  /\ jiraVer = 0
  /\ answeredCount = 0
  /\ jiraVer' = 1
  /\ answeredCount' = 1
  /\ tabShown' = IF tabLocalEdit THEN tabShown ELSE 1
  /\ UNCHANGED <<tabLocalEdit, readState, readSnapVer, readSince, closedTabVer, takeoverState, takeoverSnap, uploadState, fileHeld, jiraAttachments>>

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
  /\ UNCHANGED <<jiraVer, tabLocalEdit, answeredCount, closedTabVer, takeoverState, takeoverSnap, uploadState, fileHeld, jiraAttachments>>

\* --- 2. Multi-tab takeover with concurrent local edit (local-data.ts + jira-sync.ts) ---

StartTakeoverRead ==
  /\ takeoverState = "idle"
  /\ closedTabVer = 1
  /\ takeoverState' = "read_stored"
  /\ takeoverSnap' = closedTabVer
  /\ UNCHANGED <<jiraVer, tabShown, tabLocalEdit, answeredCount, readState, readSnapVer, readSince, closedTabVer, uploadState, fileHeld, jiraAttachments>>

LocalEditV2 ==
  /\ ~tabLocalEdit
  /\ tabShown < 2
  /\ tabLocalEdit' = TRUE
  /\ tabShown' = 2
  /\ UNCHANGED <<jiraVer, answeredCount, readState, readSnapVer, readSince, closedTabVer, takeoverState, takeoverSnap, uploadState, fileHeld, jiraAttachments>>

FinishTakeoverMerge ==
  /\ takeoverState = "read_stored"
  /\ takeoverState' = "done"
  /\ IF BUG_TAKEOVER_OVERWRITE
     THEN tabShown' = takeoverSnap
     ELSE tabShown' = IF tabLocalEdit THEN tabShown ELSE IF takeoverSnap > tabShown THEN takeoverSnap ELSE tabShown
  /\ UNCHANGED <<jiraVer, tabLocalEdit, answeredCount, readState, readSnapVer, readSince, closedTabVer, takeoverSnap, uploadState, fileHeld, jiraAttachments>>

\* --- 3. Placed upload, lost answer retry with writeLedger, and draft-upload cleaner ---

PlaceAndStartUpload ==
  /\ uploadState = "none"
  /\ uploadState' = "sending"
  /\ fileHeld' = TRUE
  /\ UNCHANGED <<jiraVer, tabShown, tabLocalEdit, answeredCount, readState, readSnapVer, readSince, closedTabVer, takeoverState, takeoverSnap, jiraAttachments>>

UploadAnsweredOk ==
  /\ uploadState = "sending"
  /\ uploadState' = "answered"
  /\ jiraAttachments' = IF jiraAttachments = 0 THEN 1 ELSE jiraAttachments
  /\ UNCHANGED <<jiraVer, tabShown, tabLocalEdit, answeredCount, readState, readSnapVer, readSince, closedTabVer, takeoverState, takeoverSnap, fileHeld>>

UploadLostAnswer ==
  /\ uploadState = "sending"
  /\ jiraAttachments' = IF jiraAttachments = 0 THEN 1 ELSE jiraAttachments
  /\ uploadState' = IF BUG_LOST_UPLOAD_REFUSED THEN "refused" ELSE "lost_retry"
  /\ fileHeld' = IF BUG_LOST_UPLOAD_REFUSED THEN FALSE ELSE fileHeld
  /\ UNCHANGED <<jiraVer, tabShown, tabLocalEdit, answeredCount, readState, readSnapVer, readSince, closedTabVer, takeoverState, takeoverSnap>>

RetryLostUploadViaLedger ==
  /\ uploadState = "lost_retry"
  \* writeLedger matches existing attachment (found = TRUE) without creating a duplicate in Jira
  /\ uploadState' = "found"
  /\ UNCHANGED <<jiraVer, tabShown, tabLocalEdit, answeredCount, readState, readSnapVer, readSince, closedTabVer, takeoverState, takeoverSnap, fileHeld, jiraAttachments>>

UserRemovesFileFromDraft ==
  /\ fileHeld = TRUE
  /\ uploadState \in {"answered", "found"}
  /\ fileHeld' = FALSE
  /\ UNCHANGED <<jiraVer, tabShown, tabLocalEdit, answeredCount, readState, readSnapVer, readSince, closedTabVer, takeoverState, takeoverSnap, uploadState, jiraAttachments>>

CleanerRuns ==
  /\ uploadState \in {"answered", "found"}
  /\ IF BUG_CLEANER_DELETES_HELD
     THEN /\ uploadState' = "deleted"
          /\ jiraAttachments' = 0
     ELSE /\ ~fileHeld
          /\ uploadState = "answered" \* found = TRUE attachments are never deleted as orphans (draft-uploads.ts:150)
          /\ uploadState' = "deleted"
          /\ jiraAttachments' = 0
  /\ UNCHANGED <<jiraVer, tabShown, tabLocalEdit, answeredCount, readState, readSnapVer, readSince, closedTabVer, takeoverState, takeoverSnap, fileHeld>>

Done ==
  /\ readState \in {"idle", "done"}
  /\ takeoverState = "done"
  /\ uploadState \in {"answered", "found", "refused", "deleted"}
  /\ UNCHANGED vars

Next ==
  \/ StartFullRead
  \/ WriteAnswersV1
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
  \/ Done

\* --- Invariants (promises to users) ---

\* Guards a0a7477c: a slow full-record read overtaken by a write answer never overwrites the newer write.
NoStaleReadRegression ==
  (answeredCount > 0 /\ ~tabLocalEdit) => (tabShown >= jiraVer)

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

====
