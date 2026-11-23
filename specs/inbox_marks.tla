---- MODULE inbox_marks ----
\* Formal model of better-jira's inbox read/unread marks, offline and NoAnswer retry,
\* page reload recovery, and delete/snooze undo interaction.
\* Covers src/client/state/inbox-store.ts (markRead, reach, restoreLocal, tidyLocal, resumeWrites)
\* and src/client/features/inbox/inbox.ts (send, leaving on pagehide).
\* Guards commits 8a43e557, fbe2c7ea, and 6e330b6b.

EXTENDS Integers

CONSTANTS
  BUG_NO_ANSWER_ROLLS_BACK, \* TRUE replays pre-8a43e557: 503 NoAnswer rejects and rolls back local mark
  BUG_UNDO_RESTORES_READ    \* TRUE replays pre-6e330b6b: undo of delete restores stale read mark after write settled

VARIABLES
  jiraRead,        \* BOOLEAN: Jira's stored read state for the group
  localRead,       \* "none" | "read" | "unread": optimistic override in localStorage["local"]
  pendingRead,     \* "none" | "read" | "unread": durable entry in localStorage["pending"]
  inFlight,        \* "none" | "read" | "unread": markRead write currently running
  deleted,         \* BOOLEAN: row deleted locally
  undoCaptured,    \* "none" | "read" | "unread": read override captured when Delete was pushed to undo stack
  undoAvailable,   \* BOOLEAN: delete undo entry is on the stack
  net,             \* "online" | "no_answer" | "offline"
  rolledBackOnNoAnswer \* BOOLEAN: TRUE only if a 503 NoAnswer rolled back an unconfirmed mark

vars == <<jiraRead, localRead, pendingRead, inFlight, deleted, undoCaptured, undoAvailable, net, rolledBackOnNoAnswer>>

BoolToMark(b) == IF b THEN "read" ELSE "unread"

Init ==
  /\ jiraRead = FALSE
  /\ localRead = "none"
  /\ pendingRead = "none"
  /\ inFlight = "none"
  /\ deleted = FALSE
  /\ undoCaptured = "none"
  /\ undoAvailable = FALSE
  /\ net = "online"
  /\ rolledBackOnNoAnswer = FALSE

SetNetworkOffline ==
  /\ net # "offline"
  /\ net' = "offline"
  /\ UNCHANGED <<jiraRead, localRead, pendingRead, inFlight, deleted, undoCaptured, undoAvailable, rolledBackOnNoAnswer>>

SetNetworkNoAnswer ==
  /\ net # "no_answer"
  /\ net' = "no_answer"
  /\ UNCHANGED <<jiraRead, localRead, pendingRead, inFlight, deleted, undoCaptured, undoAvailable, rolledBackOnNoAnswer>>

SetNetworkOnline ==
  /\ net # "online"
  /\ net' = "online"
  /\ UNCHANGED <<jiraRead, localRead, pendingRead, inFlight, deleted, undoCaptured, undoAvailable, rolledBackOnNoAnswer>>

UserMarksRead ==
  /\ ~deleted
  /\ inFlight = "none"
  /\ pendingRead = "none"
  /\ ~jiraRead
  /\ localRead' = "read"
  /\ pendingRead' = "read"
  /\ inFlight' = "read"
  /\ UNCHANGED <<jiraRead, deleted, undoCaptured, undoAvailable, net, rolledBackOnNoAnswer>>

UserDeletesRow ==
  /\ ~deleted
  /\ deleted' = TRUE
  /\ undoCaptured' = localRead
  /\ undoAvailable' = TRUE
  /\ UNCHANGED <<jiraRead, localRead, pendingRead, inFlight, net, rolledBackOnNoAnswer>>

\* Write lands in Jira when online
SendSucceeds ==
  /\ inFlight # "none"
  /\ net = "online"
  /\ jiraRead' = (inFlight = "read")
  /\ inFlight' = "none"
  /\ pendingRead' = "none"
  /\ localRead' = "none"
  /\ UNCHANGED <<deleted, undoCaptured, undoAvailable, net, rolledBackOnNoAnswer>>

\* Server answers 503 NoAnswer (Jira gateway unreachable or timed out)
SendGetsNoAnswer ==
  /\ inFlight # "none"
  /\ net = "no_answer"
  /\ IF BUG_NO_ANSWER_ROLLS_BACK
     THEN \* Pre-8a43e557 bug: treated as refusal and cleared localRead + pendingRead
       /\ inFlight' = "none"
       /\ pendingRead' = "none"
       /\ localRead' = "none"
       /\ rolledBackOnNoAnswer' = TRUE
     ELSE \* reach() catches NoAnswer, waits for reconnect, keeps localRead + pendingRead
       /\ UNCHANGED <<inFlight, pendingRead, localRead, rolledBackOnNoAnswer>>
  /\ UNCHANGED <<jiraRead, deleted, undoCaptured, undoAvailable, net>>

\* Jira explicitly refuses (502 / 4xx): rolled back cleanly
SendRefusedByJira ==
  /\ inFlight # "none"
  /\ net = "online"
  /\ inFlight' = "none"
  /\ pendingRead' = "none"
  /\ localRead' = "none"
  /\ UNCHANGED <<jiraRead, deleted, undoCaptured, undoAvailable, net, rolledBackOnNoAnswer>>

\* Browser reloads mid-write or while waiting offline: pagehide keeps pendingRead + localRead, next load calls resumeWrites
PageReload ==
  /\ inFlight # "none"
  /\ inFlight' = "none"
  /\ UNCHANGED <<jiraRead, localRead, pendingRead, deleted, undoCaptured, undoAvailable, net, rolledBackOnNoAnswer>>

ResumeWritesOnBoot ==
  /\ inFlight = "none"
  /\ pendingRead # "none"
  /\ inFlight' = pendingRead
  /\ localRead' = pendingRead
  /\ UNCHANGED <<jiraRead, pendingRead, deleted, undoCaptured, undoAvailable, net, rolledBackOnNoAnswer>>

\* User presses Z to undo delete; restoreLocal strips read/group so an old read mark never resurrects
UndoDelete ==
  /\ undoAvailable
  /\ deleted' = FALSE
  /\ undoAvailable' = FALSE
  /\ IF BUG_UNDO_RESTORES_READ
     THEN localRead' = undoCaptured
     ELSE localRead' = localRead
  /\ UNCHANGED <<jiraRead, pendingRead, inFlight, undoCaptured, net, rolledBackOnNoAnswer>>

Done ==
  /\ inFlight = "none"
  /\ pendingRead = "none"
  /\ ~undoAvailable
  /\ UNCHANGED vars

Next ==
  \/ SetNetworkOffline
  \/ SetNetworkNoAnswer
  \/ SetNetworkOnline
  \/ UserMarksRead
  \/ UserDeletesRow
  \/ SendSucceeds
  \/ SendGetsNoAnswer
  \/ SendRefusedByJira
  \/ PageReload
  \/ ResumeWritesOnBoot
  \/ UndoDelete
  \/ Done

\* --- Invariants (promises to users) ---

\* Guards 6e330b6b: a local read override never outlives its write (otherwise unread counts stay wrong forever).
NoStrandedReadMark ==
  (inFlight = "none" /\ pendingRead = "none") => (localRead = "none")

\* Guards 8a43e557 & fbe2c7ea: while offline or on NoAnswer, a pending mark stays shown and pending until settled.
PendingMarkMatchesLocal ==
  (pendingRead # "none") => (localRead = pendingRead)

\* Guards 8a43e557: a 503 NoAnswer never rolls back an unconfirmed mark to Jira's stale unread state.
NoAnswerNeverDropsMark ==
  ~rolledBackOnNoAnswer

====
