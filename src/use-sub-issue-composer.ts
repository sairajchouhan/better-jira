import { useEffect, useRef, useState } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { actions, get, ME, restoreLocalFiles, set, type Board, type Issue, type IssueDraft } from "./store";
import { discardLateMedia, documentHasMedia, normalizeDocument, type AdfDocument } from "./document";
import { rankBetween } from "./view-model";
import { childrenByParent } from "./sub-issue-model";
import { emptySubIssueDraft, readSubIssueDraft, saveSubIssueDraft, type SubIssueDraft } from "./sub-issue-draft";

/** Owns draft persistence, file restoration, late uploads, and submission for one keyed issue. */
export function useSubIssueComposer(issue: Issue, board: Board, namespace: string, setCollapsed: (value: boolean) => void) {
  const [creating, setCreating] = useState(false), [confirming, setConfirming] = useState(false);
  const initial = (): IssueDraft => ({
    parent: issue.key,
    project: issue.project,
    assignee: ME,
    priority: undefined,
    status:
      board.columns
        .find((c) => !/backlog/i.test(c.name) && c.statuses.some((s) => s.category === "new"))
        ?.statuses.find((s) => s.category === "new")?.id ?? board.columns[0]?.statuses[0]?.id,
    labels: [],
  });
  const draftKey = `better-jira:sub-issue-draft:v1:${namespace}:${issue.key}`;
  const [value, setValue] = useState(() => readSubIssueDraft(draftKey, initial())),
    pending = useRef(value),
    [editor, setEditor] = useState(0);
  const { title, description, files, properties: draft } = value;
  const update = (patch: Partial<SubIssueDraft>) => {
    const next = { ...pending.current, ...patch };
    pending.current = next;
    setValue(next);
    try {
      saveSubIssueDraft(draftKey, next);
    } catch {
      set({ perf: "Could not retain this sub-issue draft across reloads" });
    }
  };
  // An upload that finishes after this composer closed (navigation, a remount) updates whichever composer now owns the draft, else the stored draft;
  // never this closure's stale copy, which would overwrite newer edits. A discarded draft drops it (discardLateMedia).
  const scope = `${issue.key}:sub-issue`,
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const apply = (event: Event) => {
      event.preventDefault();
      update(
        (event as CustomEvent<(draft: SubIssueDraft) => Partial<SubIssueDraft>>).detail(
          pending.current,
        ),
      );
    };
    addEventListener(`late:${draftKey}`, apply);
    return () => {
      mounted.current = false;
      removeEventListener(`late:${draftKey}`, apply);
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- Draft listeners retain their session; derived rows invalidate on boards rather than render-local status helpers.
  }, [draftKey]);
  const late = (change: (draft: SubIssueDraft) => Partial<SubIssueDraft>) => {
    if (mounted.current) {
      update(change(pending.current));
      return;
    }
    if (
      dispatchEvent(
        new CustomEvent(`late:${draftKey}`, {
          detail: change,
          cancelable: true,
        }),
      )
    ) {
      try {
        const stored = readSubIssueDraft(draftKey, initial());
        saveSubIssueDraft(draftKey, { ...stored, ...change(stored) });
      } catch {}
    }
  };
  useEffect(() => {
    let active = true;
    void restoreLocalFiles(pending.current.files).then((saved) => {
      if (active)
        update({
          files: pending.current.files.map(
            (file) => saved.find((restored) => restored.id === file.id) ?? file,
          ),
        });
    });
    return () => {
      active = false;
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- Draft listeners retain their session; derived rows invalidate on boards rather than render-local status helpers.
  }, []);
  const form = useRef<HTMLDivElement>(null),
    titleInput = useRef<HTMLInputElement>(null);
  const start = () => {
    setCollapsed(false);
    setCreating(true);
    requestAnimationFrame(() => titleInput.current?.focus());
  };
  const close = () => {
    setCreating(false);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(
          `[data-sub-issues="${CSS.escape(issue.key)}"] [data-create-child]`,
        )
        ?.focus(),
    );
  };
  const discard = () => {
    discardLateMedia(scope);
    setConfirming(false);
    update(emptySubIssueDraft(initial()));
    setEditor((n) => n + 1);
    close();
  };
  // Like Linear: a draft with content asks before it is thrown away; an empty one just closes.
  const filled = () => {
    const { title, description, files } = pending.current;
    return (
      !!title.trim() ||
      files.length > 0 ||
      JSON.stringify(description).includes('"text"') ||
      documentHasMedia(description)
    );
  };
  const cancel = () => {
    if (filled()) setConfirming(true);
    else discard();
  };
  // Escape first leaves the field for the composer itself, then cancels from there.
  const escape = () => {
    if (document.activeElement !== form.current) form.current?.focus();
    else cancel();
  };
  // The editor hands over its document: a send deferred for an upload has media this render's closure has not seen (Opus review 4).
  const submit = (doc?: AdfDocument) => {
    const { title, description, files, properties: draft } = pending.current;
    if (!title.trim() || files.some((file) => file.missing)) return;
    const lastRank = [...(childrenByParent(get().issues).get(issue.key) ?? [])]
      .map((i) => i.rank ?? "")
      .sort()
      .at(-1);
    const key = actions.create(
      title,
      {
        ...draft,
        rank: rankBetween(lastRank),
        descriptionDoc: doc ?? description,
        attachments: files,
      },
      true,
    );
    if (!key) return;
    // Linear starts the next sub-issue from the defaults, not the last one's properties.
    update({
      title: "",
      description: normalizeDocument(""),
      files: [],
      properties: initial(),
    });
    setEditor((n) => n + 1);
    requestAnimationFrame(() => titleInput.current?.focus());
  };
  const submitFromButton = () =>
    form.current?.querySelector<HTMLButtonElement>(".rich-editor-submit")?.click();
  useHotkey("Mod+Enter", submitFromButton, {
    target: titleInput,
    capture: true,
    ignoreInputs: false,
  });
  useHotkey("Mod+Shift+Enter", submitFromButton, {
    target: form,
    capture: true,
    ignoreInputs: false,
  });
  useHotkey("Mod+Shift+O", () => titleInput.current?.focus(), {
    target: form,
    capture: true,
    ignoreInputs: false,
  });
  useHotkey("Escape", escape, {
    target: form,
    capture: true,
    ignoreInputs: false,
  });

  return { state: { title, description, files, draft, editor, creating, confirming },
    actions: { update, late, start, discard, cancel, submit, setConfirming },
    meta: { form, titleInput, scope, pending } };
}
