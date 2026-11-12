import type { ReactNode } from "react";
import { MediaView } from "./media-loader";
import type { Attachment } from "./attachment-media";
import { cardText, jiraDate, safeLink } from "./document";
export { adfToText } from "./document";

/** Renders Jira's ADF (Atlassian Document Format). Unknown nodes fall through to their children. */
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
      return <div className="flow-root space-y-2 leading-relaxed">{kids}</div>;
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
      return <H className={HEADING[level]}>{kids}</H>;
    }
    case "bulletList":
      return <ul className="list-disc pl-5 space-y-1">{kids}</ul>;
    case "orderedList":
      return (
        <ol start={Number(a.order) || 1} className="list-decimal pl-5 space-y-1">
          {kids}
        </ol>
      );
    case "taskList":
      return <ul className="space-y-1">{kids}</ul>;
    case "taskItem":
      return (
        <li>
          {a.state === "DONE" ? "☑" : "☐"} {kids}
        </li>
      );
    case "listItem":
      return <li>{kids}</li>;
    case "codeBlock":
      return (
        <pre className="overflow-x-auto rounded bg-col border border-line-2 p-2 text-xs">
          <code>{kids}</code>
        </pre>
      );
    case "blockquote":
      return <blockquote className="border-l-2 border-line-3 pl-3 text-fg-3">{kids}</blockquote>;
    case "panel":
      return <div className="rounded border-l-4 border-accent bg-col p-2">{kids}</div>;
    case "expand":
    case "nestedExpand":
      return (
        <details className="rounded border border-line-2 px-2 py-1">
          <summary className="cursor-pointer font-medium">{a.title || "Collapsible section"}</summary>
          {kids}
        </details>
      );
    case "rule":
      return <hr className="border-line-2" />;
    case "mention":
      return (
        <span className="mention-chip" data-mention-id={a.id}>
          {a.text || "@Unknown"}
        </span>
      );
    case "emoji":
      return <>{a.text ?? a.shortName}</>;
    case "status":
      return <span className="rounded bg-sel px-1 text-xs font-semibold uppercase">{a.text}</span>;
    case "date":
      return <>{jiraDate(a.timestamp)}</>;
    case "inlineCard":
    case "blockCard":
      return (
        <a
          className="text-accent underline"
          href={safeLink(a.url) ?? undefined}
          target="_blank"
          rel="noreferrer"
        >
          {cardText(a.url)}
        </a>
      );
    case "table":
      return (
        <table className="w-full border-collapse text-xs">
          <tbody>{kids}</tbody>
        </table>
      );
    case "tableRow":
      return <tr>{kids}</tr>;
    case "tableHeader":
      return (
        <th
          colSpan={Number(a.colspan) || 1}
          rowSpan={Number(a.rowspan) || 1}
          className="border border-line-2 p-1 text-left"
        >
          {kids}
        </th>
      );
    case "tableCell":
      return (
        <td
          colSpan={Number(a.colspan) || 1}
          rowSpan={Number(a.rowspan) || 1}
          className="border border-line-2 p-1 align-top"
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

const HEADING = [
  "",
  "pt-2 text-[20px] leading-7 font-semibold text-fg",
  "pt-1.5 text-[17px] leading-6 font-semibold text-fg",
  "pt-1 text-[15px] font-semibold text-fg",
  "text-[14px] font-semibold text-fg",
  "text-[13px] font-semibold text-fg",
  "text-[13px] font-medium text-fg-2",
];

/** Bare URLs in plain text become links, as Linear shows them. */
function linkify(text: string): ReactNode {
  const parts = text.split(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g);
  return parts.length === 1
    ? text
    : parts.map((part, i) =>
        i % 2 ? (
          <a
            key={i}
            className="text-accent underline"
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
      return <code className="rounded bg-sel px-1 text-[0.9em]">{inner}</code>;
    case "link":
      return (
        <a
          className="text-accent underline"
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
