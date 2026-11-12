import type { ReactNode } from "react";
import { MediaView } from "./media-loader";
import type { Attachment } from "./attachment-media";
import { cardText, jiraDate, safeLink } from "./document";
import { Icon } from "./icons";
import { ReadonlyCodeBlock } from "./code-block";
import { embedFrame, embedSource } from "./embed";
export { adfToText } from "./document";

/** Renders Jira's ADF (Atlassian Document Format) with the editor's DOM and classes, so `.rich-doc` styles both the
 *  same (BJ-176). Unknown nodes fall through to their children. */
export function Adf({
  node,
  issueKey,
  attachments,
}: {
  node: any;
  issueKey?: string;
  attachments?: Attachment[];
}): ReactNode {
  if (!node) return null;
  if (typeof node === "string") return <div className="whitespace-pre-wrap">{node}</div>;
  const kids = node.content?.map((c: any, i: number) => (
    <Adf key={i} node={c} issueKey={issueKey} attachments={attachments} />
  ));
  const a = node.attrs ?? {};
  switch (node.type) {
    case "doc":
      return <div className="rich-doc flow-root">{kids}</div>;
    case "paragraph":
      return <p>{kids}</p>;
    case "text":
      return (node.marks ?? []).reduce(
        mark,
        (node.marks ?? []).some((m: any) => m.type === "link" || m.type === "code")
          ? node.text
          : linkify(node.text),
      );
    case "hardBreak":
      return <br />;
    case "heading": {
      const level = Math.max(1, Math.min(6, Number(a.level) || 2)),
        H = `h${level}` as "h1";
      return <H>{kids}</H>;
    }
    case "bulletList":
      return <ul>{kids}</ul>;
    case "orderedList":
      return (
        <ol start={Number(a.order) || 1}>{kids}</ol>
      );
    case "taskList":
      return <ul data-task-list="true">{kids}</ul>;
    case "taskItem":
      return (
        <li data-task-state={a.state === "DONE" ? "DONE" : "TODO"}>{kids}</li>
      );
    case "listItem":
      return <li>{kids}</li>;
    case "codeBlock":
      return (
        <ReadonlyCodeBlock
          text={(node.content ?? []).map((c: any) => c.text ?? "").join("")}
          language={typeof a.language === "string" ? a.language : null}
        />
      );
    case "blockquote":
      return <blockquote>{kids}</blockquote>;
    case "panel":
      return (
        <div className="rich-panel" data-panel-type={a.panelType ?? "info"}>
          {kids}
        </div>
      );
    case "expand":
    case "nestedExpand":
      return (
        <details className="rich-expand">
          <summary className="rich-expand-header">
            <span className="rich-expand-toggle">
              <Icon name="chevron" size={14} />
            </span>
            <span className="rich-expand-title" data-empty={a.title ? undefined : true}>
              {a.title || "Section"}
            </span>
          </summary>
          <div className="rich-expand-body">{kids}</div>
        </details>
      );
    case "rule":
      return <hr />;
    case "mention":
      return (
        <span className="mention-chip" data-mention-id={a.id}>
          {a.text || "@Unknown"}
        </span>
      );
    case "emoji":
      return <span className="rich-emoji">{a.text ?? a.shortName}</span>;
    case "status":
      return <span className="rounded bg-sel px-1 text-xs font-semibold uppercase">{a.text}</span>;
    case "date":
      return <>{jiraDate(a.timestamp)}</>;
    case "inlineCard":
    case "blockCard":
      return (
        <a
          href={safeLink(a.url) ?? undefined}
          target="_blank"
          rel="noreferrer"
        >
          {cardText(a.url)}
        </a>
      );
    case "embedCard": {
      const src = embedSource(String(a.url ?? ""));
      if (!src) return <Adf node={{ ...node, type: "blockCard" }} />;
      const { allowfullscreen: _, referrerpolicy, sandbox, ...frame } = embedFrame(src);
      return (
        <div className="rich-embed">
          <iframe {...frame} sandbox={sandbox} allowFullScreen referrerPolicy={referrerpolicy} />
        </div>
      );
    }
    case "table": {
      // Column widths as the editor's TableView lays them out (prosemirror-tables, 50px for a column without one), so a resized table reads the same.
      const widths: number[] = (node.content?.[0]?.content ?? []).flatMap((cell: any) =>
          Array.from({ length: Number(cell.attrs?.colspan) || 1 }, (_, i) => Number(cell.attrs?.colwidth?.[i]) || 0),
        ),
        total = widths.reduce((sum, w) => sum + (w || 50), 0),
        fixed = widths.length > 0 && widths.every(Boolean);
      return (
        <div className="tableWrapper">
          <table style={fixed ? { width: total } : { minWidth: total }}>
            <colgroup>
              {widths.map((w, i) => (
                <col key={i} style={w ? { width: w } : undefined} />
              ))}
            </colgroup>
            <tbody>{kids}</tbody>
          </table>
        </div>
      );
    }
    case "tableRow":
      return <tr>{kids}</tr>;
    case "tableHeader":
      return (
        <th
          colSpan={Number(a.colspan) || 1}
          rowSpan={Number(a.rowspan) || 1}
        >
          {kids}
        </th>
      );
    case "tableCell":
      return (
        <td
          colSpan={Number(a.colspan) || 1}
          rowSpan={Number(a.rowspan) || 1}
        >
          {kids}
        </td>
      );
    case "mediaSingle":
    case "mediaGroup":
    case "media":
    case "mediaInline":
      return <MediaView node={node} issueKey={issueKey} attachments={attachments} />;
    default:
      return kids?.length ? (
        <>{kids}</>
      ) : (
        <span className="text-fg-3">[{node.type} content preserved]</span>
      );
  }
}

/** Bare URLs in plain text become links, as Linear shows them. */
function linkify(text: string): ReactNode {
  const parts = text.split(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g);
  return parts.length === 1
    ? text
    : parts.map((part, i) =>
        i % 2 ? (
          <a
            key={i}
            href={safeLink(part) ?? undefined}
            target="_blank"
            rel="noreferrer"
          >
            {part}
          </a>
        ) : (
          part
        ),
      );
}

function mark(inner: ReactNode, m: any): ReactNode {
  switch (m.type) {
    case "strong":
      return <strong>{inner}</strong>;
    case "em":
      return <em>{inner}</em>;
    case "strike":
      return <s>{inner}</s>;
    case "underline":
      return <u>{inner}</u>;
    case "code":
      return <code>{inner}</code>;
    case "link":
      return (
        <a
          href={safeLink(m.attrs?.href) ?? undefined}
          target="_blank"
          rel="noreferrer"
        >
          {inner}
        </a>
      );
    case "subsup":
      return m.attrs?.type === "sup" ? <sup>{inner}</sup> : <sub>{inner}</sub>;
    case "textColor":
      return (
        <span
          style={{
            color: /^#[\da-f]{3,8}$/i.test(m.attrs?.color ?? "") ? m.attrs.color : undefined,
          }}
        >
          {inner}
        </span>
      );
    case "backgroundColor":
      return (
        <span
          style={{
            backgroundColor: /^#[\da-f]{3,8}$/i.test(m.attrs?.color ?? "")
              ? m.attrs.color
              : undefined,
          }}
        >
          {inner}
        </span>
      );
    default:
      return inner;
  }
}

/** Text projection for search and previews. Rich editing retains the original document. */
