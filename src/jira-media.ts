import type {Op} from './jira-ops';
import {issueAttachments,type Attachment} from './attachment-media';

type Uploaded={attachment:Attachment;collection:string};
const mappings=new Map<string,Uploaded>();
const slot=(key:string,id:string)=>`better-jira:upload:${key}:${id}`;
function known(key:string,id:string):Uploaded|undefined {
 const name=slot(key,id);if(mappings.has(name))return mappings.get(name);
 try{const raw=localStorage.getItem(name);if(raw){const value=JSON.parse(raw);mappings.set(name,value);return value;}}catch{}
}
function remember(key:string,id:string,value?:Uploaded){const name=slot(key,id);if(value)mappings.set(name,value);else mappings.delete(name);try{if(value)localStorage.setItem(name,JSON.stringify(value));else localStorage.removeItem(name);}catch{}}

/** Walk every value, including future comment ops. Only local ADF media identities change. */
export async function rewriteDocuments<T>(value:T,upload:(id:string)=>Promise<{id:string;collection:string}>):Promise<T> {
 async function walk(value:any,inDoc=false):Promise<any>{
  if(!value||typeof value!=='object')return value;
  if(Array.isArray(value))return Promise.all(value.map(v=>walk(v,inDoc)));
  const doc=inDoc||value.type==='doc',out:Record<string,any>={};
  for(const [key,child] of Object.entries(value))out[key]=await walk(child,doc);
  if(doc&&['media','mediaInline'].includes(value.type)&&value.attrs?.collection==='local'){
   const identity=await upload(String(value.attrs.id));out.attrs={...out.attrs,type:'file',...identity};delete out.attrs.url;
  }
  return out;
 }
 return walk(value);
}

export function uploadedAttachments(key:string,full:any,local:Attachment[]=[]):Attachment[]{
 for(const file of local)known(key,file.id);
 return aliasAttachments(key,issueAttachments(full));
}
export function settleUploads(key:string,full:any){
 aliasAttachments(key,[]);
 const ids=new Set(issueAttachments(full).map(file=>file.id));
 for(const [name,value] of mappings)if(name.startsWith(`better-jira:upload:${key}:`)&&!ids.has(value.attachment.id))remember(key,name.slice(`better-jira:upload:${key}:`.length));
}
export function aliasAttachments(key:string,files:Attachment[],local:Attachment[]=[]):Attachment[]{
 try{for(let i=0;i<localStorage.length;i++){const name=localStorage.key(i);if(name?.startsWith(`better-jira:upload:${key}:`))known(key,name.slice(`better-jira:upload:${key}:`.length));}}catch{}
 for(const file of local)known(key,file.id);
 const aliases=new Map<string,{id:string;mediaId?:string}>();
 for(const [name,value] of mappings)if(name.startsWith(`better-jira:upload:${key}:`))aliases.set(value.attachment.id,{id:name.slice(`better-jira:upload:${key}:`.length),mediaId:value.attachment.mediaId});
 return files.map(file=>({...file,...aliases.get(file.id)}));
}

export async function prepareOps(key:string,ops:Op[]):Promise<Op[]> {
 const {localFileURL,retainJiraFile}=await import('./store');
 const pending=new Map<string,Promise<Uploaded>>();
 // A file uploaded for a document node gets its name from the job's attachment op, not the blob.
 const names=new Map(ops.flatMap(op=>op.op==='attachment.add'?[[op.id,op.name] as const]:[]));
 const upload=(id:string,name?:string):Promise<Uploaded>=>{
  const cached=known(key,id);if(cached)return Promise.resolve(cached);
  if(pending.has(id))return pending.get(id)!;
  const job=(async()=>{
   const url=await localFileURL(id);if(!url)throw new Error('This local file is unavailable.');
   const blob=await (await fetch(url)).blob(),body=new FormData();body.append('file',blob,name??names.get(id)??(blob instanceof File?blob.name:'Attachment'));
   const response=await fetch(`/api/issues/${encodeURIComponent(key)}/attachments`,{method:'POST',body});
   const result=await response.json();if(!response.ok)throw new Error(result.error??'Could not upload attachment.');
   remember(key,id,result);return result as Uploaded;
  })();pending.set(id,job);return job;
 };
 const out:Op[]=[];
 for(const op of ops){
  if(op.op==='attachment.add'){await upload(op.id,op.name);continue;}
  if(op.op==='attachment.delete'){
   const mapped=known(key,op.id),id=mapped?.attachment.id??op.id;
   if(!/^\d+$/.test(id))continue;
   // Retain bytes for undo of deleting an attachment that originated in Jira.
   if(!await localFileURL(op.id))await retainJiraFile(op.id,`/api/issues/${encodeURIComponent(key)}/attachments/${id}`);
   out.push({...op,id});continue;
  }
  out.push(await rewriteDocuments(op,async id=>{
   const result=await upload(id);if(!result.attachment.mediaId)throw new Error('Jira has not supplied a media identity. Retry the edit.');
   return {id:result.attachment.mediaId,collection:result.collection};
  }));
 }
 return out;
}

/** The document without media still stored only in this browser; used to create an issue before its files can attach. */
export function withoutLocalMedia<T>(doc:T):T {
 const walk=(node:any):any=>{
  if(!node||typeof node!=='object'||!Array.isArray(node.content))return node;
  const content=node.content.filter((child:any)=>!(['media','mediaInline'].includes(child?.type)&&child.attrs?.collection==='local')).map(walk)
   .filter((child:any)=>!(['mediaSingle','mediaGroup'].includes(child?.type)&&!child.content?.length));
  return {...node,content};
 };
 return walk(doc);
}
