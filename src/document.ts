export type AdfMark = { type:string; attrs?:Record<string,unknown>; [key:string]:unknown };
export type AdfNode = { type:string; text?:string; attrs?:Record<string,unknown>; marks?:AdfMark[]; content?:AdfNode[]; version?:number; [key:string]:unknown };
export type AdfDocument = AdfNode & {type:"doc";version:1};

export function safeLink(value:unknown):string|null {
  if(typeof value!=="string")return null;
  if(value.startsWith("#"))return value;
  try {const url=new URL(value);return ["https:","http:","mailto:"].includes(url.protocol)?url.href:null;}catch{return null;}
}
export function plainDocument(text:string):AdfDocument {
  return {type:"doc",version:1,content:text?text.split(/\n{2,}/).map(p=>({type:"paragraph",content:p.split("\n").flatMap((line,i)=>[...(i?[{type:"hardBreak"}]:[]),...(line?[{type:"text",text:line}]:[])])})):[]};
}
export function normalizeDocument(value:unknown):AdfDocument {
  if(typeof value==="string")return plainDocument(value);
  if(value&&typeof value==="object"&&(value as AdfNode).type==="doc"&&Array.isArray((value as AdfNode).content))return structuredClone(value) as AdfDocument;
  return plainDocument("");
}
