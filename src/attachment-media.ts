import {inlineMediaTypes} from './media-types';
import type { AdfNode } from "./document";

export type Attachment = {id:string;name:string;type:string;size:number;url:string;mediaId?:string;missing?:boolean};
export type AttachmentIssue = {key:string;fields:{attachment?:any[];description?:unknown;comment?:{comments?:{body?:unknown}[]}}};
type Reader = (id:string,options:{redirect:boolean;range?:string;ifRange?:string;signal?:AbortSignal})=>Promise<Response>;
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const ID = /^\d+$/;

export function issueAttachments(issue:AttachmentIssue):Attachment[] {
  return (issue.fields.attachment??[]).filter(a=>ID.test(String(a.id))).map(a=>({
    id:String(a.id),name:String(a.filename??"Attachment"),type:String(a.mimeType??"application/octet-stream"),size:Number(a.size)||0,
    url:`/api/issues/${encodeURIComponent(issue.key)}/attachments/${encodeURIComponent(a.id)}`,
    ...(typeof a.mediaId==="string"?{mediaId:a.mediaId}:{}),
  }));
}
function mediaIds(value:unknown,ids=new Set<string>()):Set<string> {
  if(!value||typeof value!=="object")return ids;
  const node=value as AdfNode;
  if(["media","mediaInline"].includes(node.type)&&typeof node.attrs?.id==="string")ids.add(node.attrs.id);
  for(const child of node.content??[])mediaIds(child,ids);
  return ids;
}

/** Reads only numeric attachment endpoints on the configured Jira origin. Redirects never receive credentials. */
export function jiraAttachmentReader(auth:{site:string;email:string;token:string},fetcher:typeof fetch=fetch):Reader {
  return async(id,{redirect,range,ifRange,signal})=>{
    if(!ID.test(id))throw new Error("Invalid attachment ID");
    if(range&&!/^bytes=(?:\d+-\d*|-\d+)$/.test(range))return new Response(null,{status:416});
    for(let attempt=0;;attempt++){
      const headers=new Headers({Authorization:"Basic "+btoa(`${auth.email}:${auth.token}`),Accept:"*/*","Accept-Encoding":"identity"});
      if(range){headers.set("Range",range);if(ifRange)headers.set("If-Range",ifRange);}
      const response=await fetcher(`${auth.site}/rest/api/3/attachment/content/${id}?redirect=${redirect}`,{headers,redirect:"manual",signal});
      if(response.status!==429||attempt>=2)return response;
      const wait=Number(response.headers.get("Retry-After")??1);
      await response.body?.cancel();
      await Bun.sleep(Math.min(Number.isFinite(wait)?Math.max(wait,0):1,5)*1000);
      signal?.throwIfAborted();
    }
  };
}

export function localMediaRequest(req:Request):boolean {
  const url=new URL(req.url),host=req.headers.get("host"),origin=req.headers.get("origin");
  return ["localhost","127.0.0.1","[::1]"].includes(url.hostname)&&(!host||host===url.host)&&(!origin||origin===url.origin)&&[null,"same-origin","none"].includes(req.headers.get("sec-fetch-site"));
}

/** Authenticated content and media-UUID lookup, bound to attachments on a mirrored issue. */
export function attachmentGateway({readIssue,read,lookup=()=>undefined,remember=()=>{},now=Date.now}:{
  readIssue:(key:string)=>Promise<AttachmentIssue|undefined>;read:Reader;
  lookup?:(id:string)=>string|undefined;remember?:(id:string,mediaId:string)=>void;now?:()=>number;
}) {
  const pending=new Map<string,Promise<string|undefined>>();
  const cache=new Map<string,string>();
  const noMediaId=new Map<string,number>();
  async function identify(id:string) {
    const known=cache.get(id)??lookup(id);if(known)return known;
    if((noMediaId.get(id)??0)>now())return;
    const absent=()=>{noMediaId.set(id,now()+60000);return undefined;};
    const existing=pending.get(id);if(existing)return existing;
    const request=(async()=>{
      const response=await read(id,{redirect:true,signal:AbortSignal.timeout(10000)});
      try {
        if(!response.ok&&![301,302,303,307,308].includes(response.status))throw new Error("Could not read media identity");
        if(![301,302,303,307,308].includes(response.status))return absent();
        const location=response.headers.get("Location");if(!location)return absent();
        let url:URL;try{url=new URL(location);}catch{return absent();}
        // Inspect the redirect identity only. Signed URLs and response bodies never reach the client or cache.
        if(url.protocol!=="https:"||url.username||url.password||!/(^|\.)media\.atlassian\.com$/.test(url.hostname))return absent();
        const match=url.pathname.match(/^\/file\/([a-f\d-]+)\/binary$/i),uuid=match?.[1];
        if(!uuid||!UUID.test(uuid))return absent();
        cache.set(id,uuid);remember(id,uuid);return uuid;
      } finally {await response.body?.cancel();}
    })().finally(()=>pending.delete(id));
    pending.set(id,request);return request;
  }
  async function resolve(key:string,mediaId:string):Promise<Attachment|undefined> {
    if(!UUID.test(mediaId)&&!ID.test(mediaId))return;
    const issue=await readIssue(key);if(!issue)return;
    const attachments=issueAttachments(issue);
    const direct=attachments.find(a=>a.id===mediaId||a.mediaId===mediaId||(cache.get(a.id)??lookup(a.id))===mediaId);
    if(direct)return {...direct,mediaId};
    const referenced=mediaIds(issue.fields.description);
    for(const comment of issue.fields.comment?.comments??[])mediaIds(comment.body,referenced);
    if(!referenced.has(mediaId))return;
    // Bounded discovery; concurrent image nodes share each metadata request.
    let next=0,found:Attachment|undefined,failed=false;
    await Promise.all(Array.from({length:Math.min(4,attachments.length)},async()=>{
      while(!found&&next<attachments.length){const attachment=attachments[next++]!;
        try {if(await identify(attachment.id)===mediaId)found={...attachment,mediaId};}
        catch {failed=true;}
      }
    }));
    if(!found&&failed)throw new Error("Could not resolve Jira media");
    return found;
  }
  async function content(req:Request,key:string,id:string):Promise<Response> {
    if(req.method!=="GET")return new Response("Method not allowed",{status:405,headers:{Allow:"GET"}});
    if(!localMediaRequest(req))return new Response("Forbidden",{status:403});
    if(!ID.test(id))return new Response("Attachment not found",{status:404});
    const issue=await readIssue(key),attachment=issue&&issueAttachments(issue).find(a=>a.id===id);
    if(!attachment)return new Response("Attachment not found",{status:404});
    const upstream=await read(id,{redirect:false,range:req.headers.get("range")??undefined,ifRange:req.headers.get("if-range")??undefined,signal:req.signal});
    if(![200,206,416].includes(upstream.status)){
      await upstream.body?.cancel();
      return new Response("Could not load attachment. Retry the request.",{status:[401,403,404,429].includes(upstream.status)?upstream.status:502});
    }
    const encoded=!!upstream.headers.get("Content-Encoding")&&upstream.headers.get("Content-Encoding")!=="identity";
    if(encoded&&upstream.status===206){await upstream.body?.cancel();return new Response("Unexpected compressed byte range",{status:502});}
    const headers=new Headers({"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox; default-src 'none'"});
    headers.set("Content-Type",inlineMediaTypes.test(attachment.type)?attachment.type:"application/octet-stream");
    const download=new URL(req.url).searchParams.has("download")||!inlineMediaTypes.test(attachment.type);
    headers.set("Content-Disposition",`${download?"attachment":"inline"}; filename*=UTF-8''${encodeURIComponent(attachment.name).replace(/['()*]/g,c=>`%${c.charCodeAt(0).toString(16)}`)}`);
    for(const name of ["Content-Length","Content-Range","Accept-Ranges","ETag","Last-Modified"])if(upstream.headers.has(name)&&!(encoded&&["Content-Length","ETag"].includes(name)))headers.set(name,upstream.headers.get(name)!);
    if(upstream.status===416&&!headers.has("Content-Range"))headers.set("Content-Range",`bytes */${attachment.size}`);
    if(!headers.has("Accept-Ranges"))headers.set("Accept-Ranges","bytes");
    return new Response(upstream.body,{status:upstream.status,headers});
  }
  return {resolve,content};
}
