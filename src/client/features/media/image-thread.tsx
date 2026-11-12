import { useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { useHotkey, useHotkeys } from "@tanstack/react-hotkeys";
import type { ImageComment } from "./media-edits";
import { ActionMenu } from "@/client/components/action-menu";
import { ConfirmDialog } from "@/client/components/dialog";
import { Button, IconButton, SendButton } from "@/client/components/button";
import { AutoResizingTextArea } from "@/client/components/field";
import { notifyMedia } from "./media-toast";
import { Icon } from "@/client/components/icons";
export type ImageThreadDraft = { text: string; editing?: string; beforeEdit?: string };
export function ImageThread({
  comments,
  author,
  save,
  close,
  draft,
  setDraft,
}: {
  draft: ImageThreadDraft;
  setDraft: Dispatch<SetStateAction<ImageThreadDraft>>;
  comments: ImageComment[];
  author: string;
  save: (comments: ImageComment[]) => void;
  close: () => void;
}) {
  const form = useRef<HTMLFormElement>(null),
    root = useRef<HTMLDivElement>(null);
  const { text, editing } = draft;
  const setText = (text: string) => setDraft((value) => ({ ...value, text })),
    setEditing = (editing: string | undefined) => setDraft((value) => ({ ...value, editing }));
  const [menu, setMenu] = useState<{ anchor: HTMLElement; comment: ImageComment }>();
  const focusText = () =>
    requestAnimationFrame(() => root.current?.querySelector("textarea")?.focus());
  useHotkeys(
    [
      { hotkey: "Mod+Enter", callback: () => form.current?.requestSubmit() },
      { hotkey: "Escape", callback: close },
    ],
    { target: root, capture: true, ignoreInputs: false },
  );
  return (
    <div
      ref={root}
      className="image-comment-thread"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div aria-label="Comment thread on image">
        {comments.map((comment) => (
          <div key={comment.id} data-image-comment={comment.id}>
            <div className="image-comment-meta">
              <span>{comment.author}</span>
              <time title={new Date(comment.at).toLocaleString()} dateTime={comment.at}>
                {new Date(comment.at).toLocaleDateString()}
              </time>
              <IconButton
                label="Image comment options"
                className="ml-auto"
                aria-expanded={menu?.comment.id === comment.id}
                onClick={(event) => setMenu({ anchor: event.currentTarget, comment })}
              >
                <Icon name="dots" />
              </IconButton>
            </div>
            <p>{comment.text}</p>
          </div>
        ))}
      </div>
      <form
        ref={form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!text.trim()) return;
          save(
            editing && comments.some((c) => c.id === editing)
              ? comments.map((c) => (c.id === editing ? { ...c, text: text.trim() } : c))
              : [
                  ...comments,
                  {
                    id: crypto.randomUUID(),
                    text: text.trim(),
                    author,
                    at: new Date().toISOString(),
                  },
                ],
          );
          setText("");
          setEditing(undefined);
          root.current?.querySelector("textarea")?.focus();
        }}
      >
        <span className="image-comment-avatar" aria-hidden="true">
          {author[0]}
        </span>
        <AutoResizingTextArea
          autoFocus
          aria-label="Image comment"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Add a comment…"
        />
        <SendButton
          type="submit"
          disabled={!text.trim()}
          disabledReason="Write a comment first"
          label={editing ? "Save image comment" : "Submit image comment"}
        />
      </form>
      {editing && (
        <Button
          variant="borderless"
          size="medium"
          onClick={() => {
            setEditing(undefined);
            setText(draft.beforeEdit ?? "");
            root.current?.querySelector("textarea")?.focus();
          }}
        >
          Cancel edit
        </Button>
      )}
      {/* Outside the thread's DOM, so Escape closes only the menu and not the thread (BJ-163). */}
      {menu &&
        createPortal(
          <ActionMenu
            label="Image comment options"
            anchor={menu.anchor}
            align="end"
            close={() => setMenu(undefined)}
            entries={[
              {
                name: "Edit image comment",
                icon: "pencil",
                run: () => {
                  if (!editing) setDraft((value) => ({ ...value, beforeEdit: text }));
                  setEditing(menu.comment.id);
                  setText(menu.comment.text);
                  // After the menu hands focus back to its trigger.
                  focusText();
                },
              },
              {
                name: "Delete image comment",
                icon: "trash",
                run: () => {
                  save(comments.filter((c) => c.id !== menu.comment.id));
                  if (editing === menu.comment.id) {
                    setEditing(undefined);
                    notifyMedia("Comment deleted. Your draft is kept as a new comment.");
                  }
                  focusText();
                },
              },
            ]}
          />,
          document.body,
        )}
    </div>
  );
}
/** An image's comments in Activity form one thread, like Linear's: replies, edit and delete work even after the image leaves the description. */
export function ImageCommentCard({
  comments,
  src,
  head,
  me,
  author,
  view,
  save,
}: {
  comments: ImageComment[];
  src?: string;
  head: (comment: ImageComment) => ReactNode;
  me: ReactNode;
  author: string;
  view: () => void;
  save: (comments: ImageComment[]) => void;
}) {
  const [menu, setMenu] = useState<{ anchor: HTMLElement; id: string }>(),
    [editing, setEditing] = useState<string>(),
    [deleting, setDeleting] = useState<string>(),
    [text, setText] = useState(""),
    [reply, setReply] = useState("");
  const root = useRef<HTMLLIElement>(null),
    replyForm = useRef<HTMLFormElement>(null),
    done = (id: string) => {
      setEditing(undefined);
      requestAnimationFrame(() =>
        root.current
          ?.querySelector<HTMLElement>(
            `#image-comment-${CSS.escape(id)} [aria-label="Comment options"]`,
          )
          ?.focus(),
      );
    };
  const send = () => {
    if (!reply.trim()) return;
    save([
      ...comments,
      { id: crypto.randomUUID(), text: reply.trim(), author, at: new Date().toISOString() },
    ]);
    setReply("");
  };
  // The send button's ⌘↵, the same registry chord the image comment's form uses.
  useHotkey("Mod+Enter", () => replyForm.current?.requestSubmit(), { target: replyForm, ignoreInputs: false });
  return (
    <li ref={root} data-image-thread className="comment-thread rounded-lg bg-card">
      {src && (
        <img
          data-image-comment-thumbnail
          alt=""
          src={src}
          className="mx-3 mt-2.5 h-[100px] max-w-[178px] rounded object-cover"
        />
      )}
      {comments.map((comment, i) => (
        <div
          key={comment.id}
          id={`image-comment-${comment.id}`}
          className={`comment-message ${i ? "comment-reply" : ""}`}
        >
          <div className="comment-head">
            {head(comment)}
            <span className="ml-auto flex">
              <IconButton
                label="Comment options"
                aria-expanded={menu?.id === comment.id}
                className="media-comment-action"
                onClick={(e) => setMenu({ anchor: e.currentTarget, id: comment.id })}
              >
                <Icon name="dots" />
              </IconButton>
            </span>
          </div>
          {editing === comment.id ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) {
                  save(
                    comments.map((c) => (c.id === comment.id ? { ...c, text: text.trim() } : c)),
                  );
                  done(comment.id);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  done(comment.id);
                }
              }}
            >
              <AutoResizingTextArea
                autoFocus
                aria-label="Edit image comment"
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="mt-1.5 w-full"
              />
              <div className="flex justify-end gap-2 text-[12px]">
                <Button variant="secondary" size="medium" onClick={() => done(comment.id)}>
                  Cancel
                </Button>
                <Button type="submit" size="medium" disabled={!text.trim()}>
                  Save
                </Button>
              </div>
            </form>
          ) : (
            <p className="comment-body">{comment.text}</p>
          )}
        </div>
      ))}
      <Button variant="link" size="medium" className="mx-3" onClick={view}>
        View image
      </Button>
      <div className="comment-reply-composer">
        <form
          ref={replyForm}
          className="comment-reply-row"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          {me}
          <AutoResizingTextArea
            rows={1}
            aria-label="Reply to image thread"
            placeholder="Leave a reply…"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
          <SendButton
            type="submit"
            label="Submit image reply"
            disabled={!reply.trim()}
            disabledReason="Write a reply first"
          />
        </form>
      </div>
      {menu && (
        <ActionMenu
          label="Comment options"
          anchor={menu.anchor}
          align="end"
          close={() => setMenu(undefined)}
          entries={[
            {
              name: "Edit",
              icon: "pencil",
              run: () => {
                setText(comments.find((c) => c.id === menu.id)?.text ?? "");
                setEditing(menu.id);
              },
            },
            {
              name: "Delete",
              icon: "trash",
              divider: true,
              run: () => setDeleting(menu.id),
            },
          ]}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this comment?"
          description="You cannot undo this action."
          confirmLabel="Delete"
          onConfirm={() => {
            setDeleting(undefined);
            save(comments.filter((c) => c.id !== deleting));
          }}
          close={() => setDeleting(undefined)}
        />
      )}
    </li>
  );
}
