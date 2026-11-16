import { type Board, type Issue, type IssueDraft } from "@/shared/issue-model";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { get, set } from "@/client/state/store";
import { actions } from "@/client/state/issue-actions";
import { addLocalFiles, restoreLocalFiles } from "@/client/state/local-database";
import { discardLateMedia, lateMediaDiscarded, normalizeDocument, type AdfDocument } from "@/shared/document";
import { rankBetween } from "@/shared/view-model";
import { childrenByParent } from "./sub-issue-model";
import { emptySubIssueDraft, nextSubIssueProperties, readSubIssueDraft, reopenedSubIssueDraft, saveSubIssueDraft, newSubIssueDraft, subIssueDraftFilled, subIssueDraftKey, type SubIssueDraft } from "./sub-issue-draft";

/** Owns draft persistence, file restoration, late uploads, and submission for one keyed issue. */
export function useSubIssueComposer(issue: Issue, board: Board, namespace: string, setCollapsed: (value: boolean) => void) {
  const [creating, setCreating] = useState(false), [confirming, setConfirming] = useState(false);
  const initial = (): IssueDraft => newSubIssueDraft(issue);
  const draftKey = subIssueDraftKey(namespace, issue.key);
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
  // Property edits merge into the latest draft, so two quick picks never overwrite each other.
  const setProperties = (patch: IssueDraft) =>
    update({ properties: { ...pending.current.properties, ...patch } });
  // Uploads saved after a discard are dropped; otherwise they join the draft as it is when they land.
  const addFiles = async (selected: File[]) => {
    const since = performance.now(),
      saved = await addLocalFiles(selected);
    if (!lateMediaDiscarded(scope, since)) late((draft) => ({ files: [...draft.files, ...saved] }));
    return saved;
  };
  const onLateMedia = (merge: (current: unknown) => AdfDocument) =>
    late((draft) => ({ description: merge(draft.description) }));
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
  // The issue this composer made last, while the section stays mounted (Linear's `previousIssue`): a composer reopened after
  // the section was collapsed starts from it; Escape and Discard drop it (`reopenedSubIssueDraft`, BJ-235).
  const previous = useRef<IssueDraft | undefined>(undefined);
  const start = () => {
    if (!creating) update(reopenedSubIssueDraft(pending.current, previous.current, initial()));
    setCollapsed(false);
    setCreating(true);
    requestAnimationFrame(() => titleInput.current?.focus());
  };
  // Linear's section toggle (`se`): collapsing closes the composer, keeping its draft and the issue made last.
  const toggleSection = (open: boolean) => {
    setCollapsed(!open);
    if (!open) setCreating(false);
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
    previous.current = undefined;
    setConfirming(false);
    update(emptySubIssueDraft(initial()));
    setEditor((n) => n + 1);
    close();
  };
  // Like Linear: a draft with content asks before it is thrown away; an empty one just closes.
  const cancel = () => {
    if (subIssueDraftFilled(pending.current)) setConfirming(true);
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
    const fromDefaults = shifted.current;
    shifted.current = false;
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
    previous.current = draft;
    update({
      title: "",
      description: normalizeDocument(""),
      files: [],
      properties: nextSubIssueProperties(draft, initial(), fromDefaults),
    });
    setEditor((n) => n + 1);
    requestAnimationFrame(() => titleInput.current?.focus());
  };
  const submitFromButton = () =>
    form.current?.querySelector<HTMLButtonElement>(".rich-editor-submit")?.click();
  // ⌘⇧↵ or a Shift-click on Create starts the next draft from the defaults; ⌘↵ or a plain click from the sub-issue it
  // creates. Linear's sub-issue composer (`xm`) reads the save event: `n.shiftKey||…?l(Cm(t.team,h,t)):l(Cm(t.team,h,t,r))`.
  const shifted = useRef(false);
  const onClickCapture = (event: MouseEvent) => {
    if (event.shiftKey && (event.target as Element).closest(".rich-editor-submit")) shifted.current = true;
  };
  useHotkey("Mod+Enter", submitFromButton, {
    target: titleInput,
    capture: true,
    ignoreInputs: false,
  });
  useHotkey("Mod+Shift+Enter", () => {
    shifted.current = true;
    submitFromButton();
  }, {
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
    actions: { update, setProperties, addFiles, onLateMedia, start, toggleSection, discard, cancel, submit, setConfirming },
    // The editor's late-media scope; the composer applies its rules itself.
    meta: { form, titleInput, scope, onClickCapture } };
}
