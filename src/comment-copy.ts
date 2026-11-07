import {normalizeDocument,type AdfDocument,type AdfNode} from './document';
import type {Attachment} from './attachment-media';

/** Copy remote bytes once into local storage; copied descriptions never depend on the new Jira issue existing. */
export async function copyCommentDocument(body:AdfDocument,source:string,attachments:Attachment[],save:(files:File[])=>Promise<Attachment[]>) {
 const document=normalizeDocument(body),ids=new Set<string>(),mapped=new Map<string,Attachment>();
 const collect=(node:AdfNode)=>{if(['media','mediaInline'].includes(node.type)&&node.attrs?.type!=='external'&&node.attrs?.id)ids.add(String(node.attrs.id));node.content?.forEach(collect);};collect(document);
 const pending:{id:string;file:File}[]=[];
 for(const id of ids){
  const local=attachments.find(file=>file.id===id||file.mediaId===id);
  if(local){if(local.missing)throw new Error(`The saved file ${local.name} is unavailable`);mapped.set(id,local);continue;}
  const resolved=await fetch(`/api/issues/${encodeURIComponent(source)}/media/${encodeURIComponent(id)}`);
  if(!resolved.ok)throw new Error('Could not resolve a comment attachment');
  const file=await resolved.json() as Attachment;
  if(!file.url?.startsWith(`/api/issues/${encodeURIComponent(source)}/attachments/`))throw new Error('Invalid attachment source');
  const response=await fetch(file.url);if(!response.ok)throw new Error('Could not copy the comment attachment');
  pending.push({id,file:new File([await response.blob()],file.name,{type:file.type})});
 }
 if(pending.length){const saved=await save(pending.map(entry=>entry.file));pending.forEach((entry,index)=>{const file=saved[index];if(!file)throw new Error('Could not save the comment attachment');mapped.set(entry.id,file);});}
 const rewrite=(node:AdfNode):AdfNode=>{
  const file=['media','mediaInline'].includes(node.type)?mapped.get(String(node.attrs?.id??'')):undefined;
  return {...node,...(file?{attrs:{...node.attrs,id:file.id,type:'file',collection:''}}:{}),...(node.content?{content:node.content.map(rewrite)}:{})};
 };
 return {body:rewrite(document) as AdfDocument,attachments:[...new Map([...mapped.values()].map(file=>[file.id,file])).values()]};
}
