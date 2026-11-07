import type {AdfDocument} from './document';
import type {User} from './store';
export type DocumentRevision={title:string;body:AdfDocument;at:string;author:User};
export type DocumentProperties={reminder?:{at:string;delivered?:boolean}|null;owner?:User;editedBy?:User;subscribers?:User[];showAuthors?:boolean;icon?:{name:string;color:string};history?:DocumentRevision[]};
export type IssueResource=DocumentProperties&{id:string;kind:'link'|'pull-request'|'document';title:string;updated:string;/** When a link was added; Activity shows "linked" at this time. */created?:string;url?:string;body?:AdfDocument;/** A link's unfurled page, fetched after it is added. */preview?:LinkPreview};
/** A link added without its own title shows the page title once it is unfurled, like Linear. */
export const linkTitle=(resource:IssueResource)=>resource.title===resource.url&&resource.preview?.title?resource.preview.title:resource.title;
export type LinkPreview={title?:string;description?:string;icon?:string};
export const validLinkPreview=(value:unknown)=>value===undefined||!!value&&typeof value==='object'&&!Array.isArray(value)&&['title','description'].every(key=>{const v=(value as Record<string,unknown>)[key];return v===undefined||typeof v==='string';})&&((value as LinkPreview).icon===undefined||typeof (value as LinkPreview).icon==='string'&&resourceURL((value as LinkPreview).icon!)!==null);
export function findIssueDocument(issues:Iterable<import('./store').Issue>,id:string){
 for(const issue of issues){const resource=issue.resources?.find(r=>r.kind==='document'&&r.id===id);if(resource)return {issue,resource};}
}
export function validDocumentProperties(value:DocumentProperties,validDocument:(value:unknown)=>boolean){
 const user=(value:unknown):value is User=>!!value&&typeof value==='object'&&typeof (value as User).id==='string'&&typeof (value as User).name==='string';
 return (value.owner===undefined||user(value.owner))&&(value.editedBy===undefined||user(value.editedBy))&&(value.subscribers===undefined||Array.isArray(value.subscribers)&&value.subscribers.every(user))&&(value.showAuthors===undefined||typeof value.showAuthors==='boolean')&&(value.reminder==null||typeof value.reminder.at==='string'&&Number.isFinite(Date.parse(value.reminder.at))&&(value.reminder.delivered===undefined||typeof value.reminder.delivered==='boolean'))&&(value.icon===undefined||!!value.icon&&typeof value.icon.name==='string'&&/^#[a-f\d]{6}$/i.test(value.icon.color))&&(value.history===undefined||Array.isArray(value.history)&&value.history.every(revision=>!!revision&&typeof revision.title==='string'&&typeof revision.at==='string'&&user(revision.author)&&validDocument(revision.body)));
}
export function resourceURL(value:string):string|null {
 try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!/%20/i.test(url.hostname)?url.href:null;}catch{return null;}
}

export function resourceMediaIds(node:unknown,ids=new Set<string>()):Set<string>{
 if(!node||typeof node!=='object')return ids;
 const value=node as {type?:string;attrs?:{id?:string};content?:unknown[];body?:unknown;history?:{body?:unknown}[]};
 if(['media','mediaInline'].includes(value.type??'')&&value.attrs?.id)ids.add(String(value.attrs.id));
 for(const child of value.content??[])resourceMediaIds(child,ids);
 if(value.body)resourceMediaIds(value.body,ids);
 for(const revision of value.history??[])resourceMediaIds(revision.body,ids);
 return ids;
}
