import type {Issue,Full} from "./store";
import type {AdfNode} from "./rich-document";

const escape=(text:string)=>text.replace(/[\\`*_[\]<>]/g,"\\$&");
const destination=(url:string)=>url.replace(/[\s()<>]/g,char=>encodeURIComponent(char).replace(/\(/g,"%28").replace(/\)/g,"%29"));
export function adfToMarkdown(node:AdfNode|string|null|undefined):string {
  if(!node)return "";if(typeof node==="string")return node;
  const attrs=node.attrs??{},children=node.content??[],inline=()=>children.map(adfToMarkdown).join("");
  if(node.type==="text"){
    let text=escape(node.text??"");
    for(const mark of node.marks??[])switch(mark.type){case "strong":text=`**${text}**`;break;case "em":text=`_${text}_`;break;case "strike":text=`~~${text}~~`;break;case "code":{const ticks="`".repeat(Math.max(1,...(node.text?.match(/`+/g)??[]).map(s=>s.length+1)));text=`${ticks}${node.text?.startsWith("`")?" ":""}${node.text??""}${node.text?.endsWith("`")?" ":""}${ticks}`;break;}case "link":text=`[${text}](${destination(String(mark.attrs?.href??""))})`;}
    return text;
  }
  switch(node.type){
    case "doc":return children.map(adfToMarkdown).join("\n\n");
    case "paragraph":return inline();
    case "heading":return `${"#".repeat(Math.max(1,Math.min(6,Number(attrs.level)||2)))} ${inline()}`;
    case "hardBreak":return "  \n";
    case "bulletList":case "orderedList":return children.map((child,index)=>{const prefix=node.type==="orderedList"?`${index+(Number(attrs.order)||1)}. `:"- ";return adfToMarkdown(child).split("\n").map((line,i)=>(i?" ".repeat(prefix.length):prefix)+line).join("\n");}).join("\n");
    case "listItem":return children.map(adfToMarkdown).join("\n\n");
    case "taskList":return children.map(adfToMarkdown).join("\n");
    case "taskItem":return `- [${attrs.state==="DONE"?"x":" "}] ${inline()}`;
    case "codeBlock":{const raw=children.map(child=>child.text??"").join(""),fence="`".repeat(Math.max(3,...(raw.match(/`+/g)??[]).map(s=>s.length+1)));return `${fence}${String(attrs.language??"").replace(/[\r\n]/g,"")}\n${raw}\n${fence}`;}
    case "blockquote":return children.map(adfToMarkdown).join("\n\n").split("\n").map(line=>`> ${line}`).join("\n");
    case "rule":return "---";
    case "mention":case "status":case "emoji":return String(attrs.text??attrs.shortName??"");
    case "inlineCard":case "blockCard":return String(attrs.url??"");
    case "table":return children.map((row,index)=>{const cells=(row.content??[]).map(cell=>adfToMarkdown(cell).replaceAll("|","\\|").replaceAll("\n","<br>"));return `| ${cells.join(" | ")} |${index===0?`\n| ${cells.map(()=>"---").join(" | ")} |`:""}`;}).join("\n");
    case "tableHeader":case "tableCell":return children.map(adfToMarkdown).join("\n");
    case "media":return "[Jira attachment]";
    default:return inline();
  }
}
export const copyKinds=["ID","URL","title","title as link","issue as Markdown","everything as Markdown","git branch name"] as const;
export type CopyKind=typeof copyKinds[number];
export function issueCopy(kind:CopyKind,issue:Issue,full:Full|undefined,url:string,status:string):string {
  const title=`${issue.key} ${issue.summary}`;
  switch(kind){
    case "ID":return issue.key;
    case "URL":return url;
    case "title":return issue.summary;
    case "title as link":return `[${escape(title)}](${destination(url)})`;
    case "git branch name":return `${issue.key.toLowerCase()}-${issue.summary.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}`;
    default:{
      const description=adfToMarkdown(full?.fields.description??issue.description);
      const base=`# ${escape(title)}\n\n${description}`;
      if(kind==="issue as Markdown")return base;
      const comments=(full?.fields.comment?.comments??[]).map((c:any)=>`${escape(c.author?.displayName??"Unknown")}: ${adfToMarkdown(c.body)}`).join("\n\n");
      return `${base}\n\nStatus: ${status}\nAssignee: ${issue.assignee?.name??"Unassigned"}\nPriority: ${issue.priority??"None"}\nLabels: ${issue.labels.join(", ")}\n${issue.due?`Due date: ${issue.due}\n`:""}\n${comments}`;
    }
  }
}
