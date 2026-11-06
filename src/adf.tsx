import type { ReactNode } from "react";
import { safeLink } from "./document";

/** Renders Jira's ADF (Atlassian Document Format). Unknown nodes fall through to their children. */
export function Adf({ node }: { node: any }): ReactNode {
  if (!node) return null;
  if(typeof node==="string")return <div className="whitespace-pre-wrap">{node}</div>;
  const kids = node.content?.map((c: any, i: number) => <Adf key={i} node={c} />);
  const a = node.attrs ?? {};
  switch (node.type) {
    case "doc": return <div className="space-y-2 leading-relaxed">{kids}</div>;
    case "paragraph": return <p>{kids}</p>;
    case "text": return (node.marks ?? []).reduce(mark, node.text);
    case "hardBreak": return <br />;
    case "heading": return <p className="font-semibold text-[15px] text-fg pt-1">{kids}</p>;
    case "bulletList": return <ul className="list-disc pl-5 space-y-1">{kids}</ul>;
    case "orderedList": return <ol start={Number(a.order)||1} className="list-decimal pl-5 space-y-1">{kids}</ol>;
    case "taskList": return <ul className="space-y-1">{kids}</ul>;
    case "taskItem": return <li>{a.state === "DONE" ? "☑" : "☐"} {kids}</li>;
    case "listItem": return <li>{kids}</li>;
    case "codeBlock": return <pre className="overflow-x-auto rounded bg-col border border-line-2 p-2 text-xs"><code>{kids}</code></pre>;
    case "blockquote": return <blockquote className="border-l-2 border-line-3 pl-3 text-fg-3">{kids}</blockquote>;
    case "panel": return <div className="rounded border-l-4 border-accent bg-col p-2">{kids}</div>;
    case "rule": return <hr className="border-line-2" />;
    case "mention": return <span className="text-accent">{a.text}</span>;
    case "emoji": return <>{a.text ?? a.shortName}</>;
    case "status": return <span className="rounded bg-sel px-1 text-xs font-semibold uppercase">{a.text}</span>;
    case "date": return <>{new Date(Number(a.timestamp)).toLocaleDateString()}</>;
    case "inlineCard":
    case "blockCard": return <a className="text-accent underline" href={safeLink(a.url)??undefined} target="_blank" rel="noreferrer">{a.url}</a>;
    case "table": return <table className="w-full border-collapse text-xs"><tbody>{kids}</tbody></table>;
    case "tableRow": return <tr>{kids}</tr>;
    case "tableHeader": return <th colSpan={Number(a.colspan)||1} rowSpan={Number(a.rowspan)||1} className="border border-line-2 p-1 text-left">{kids}</th>;
    case "tableCell": return <td colSpan={Number(a.colspan)||1} rowSpan={Number(a.rowspan)||1} className="border border-line-2 p-1 align-top">{kids}</td>;
    case "mediaSingle":
    case "mediaGroup":
    case "media": return <span className="block italic text-fg-3">[attachment]</span>;
    default: return kids?.length?<>{kids}</>:<span className="text-fg-3">[{node.type} content preserved]</span>;
  }
}

function mark(inner: ReactNode, m: any): ReactNode {
  switch (m.type) {
    case "strong": return <strong>{inner}</strong>;
    case "em": return <em>{inner}</em>;
    case "strike": return <s>{inner}</s>;
    case "underline": return <u>{inner}</u>;
    case "code": return <code className="rounded bg-sel px-1 text-[0.9em]">{inner}</code>;
    case "link": return <a className="text-accent underline" href={safeLink(m.attrs?.href)??undefined} target="_blank" rel="noreferrer">{inner}</a>;
    case "subsup": return m.attrs?.type==="sup"?<sup>{inner}</sup>:<sub>{inner}</sub>;
    case "textColor": return <span style={{color:/^#[\da-f]{3,8}$/i.test(m.attrs?.color??"")?m.attrs.color:undefined}}>{inner}</span>;
    case "backgroundColor": return <span style={{backgroundColor:/^#[\da-f]{3,8}$/i.test(m.attrs?.color??"")?m.attrs.color:undefined}}>{inner}</span>;
    default: return inner;
  }
}

/** Plain text → ADF: blank lines split paragraphs, single newlines become hard breaks. */
export function textToAdf(text: string) {
  return {
    type: "doc",
    version: 1,
    content: text.trim().split(/\n{2,}/).map((p) => ({
      type: "paragraph",
      content: p.split("\n").flatMap((line, i) => [
        ...(i ? [{ type: "hardBreak" }] : []),
        ...(line ? [{ type: "text", text: line }] : []),
      ]),
    })),
  };
}

/** Text projection for search and previews. Rich editing retains the original document. */
export function adfToText(node: any): string {
  if (!node) return "";
  if(typeof node==="string")return node;
  if (node.type === "text") return node.text;
  if (node.type === "hardBreak") return "\n";
  if (node.attrs?.text) return node.attrs.text;
  if (node.type === "inlineCard") return node.attrs?.url ?? "";
  const kids: string[] = (node.content ?? []).map(adfToText);
  if (node.type === "doc") return kids.join("\n\n");
  if (node.type === "bulletList" || node.type === "orderedList") return kids.map((k) => `- ${k}`).join("\n");
  return kids.join(node.type === "listItem" ? "\n" : "");
}
