import {useState} from 'react';
import {Icon} from './icons';
import type {Attachment} from './attachment-media';
import {attachmentLink} from './media-layout';
export function FileMedia({file,issueKey}:{file:Attachment;issueKey?:string}){
 const [notice,setNotice]=useState('');
 const size=file.size<1024?`${file.size} B`:file.size<1024*1024?`${Math.round(file.size/1024)} KB`:`${(file.size/(1024*1024)).toFixed(1)} MB`;
 return <div className="file-media" data-attachment-id={file.id} tabIndex={0}>
  <Icon name="file" size={20}/><div className="min-w-0 flex-1"><div className="truncate">{file.name}</div><div className="text-[11px] text-fg-3">{size}</div></div>
  <div className="file-media-actions" role="toolbar" aria-label="File actions"><button aria-label="Copy attachment link" disabled={!issueKey&&file.url.startsWith('blob:')} title={!issueKey?'Create the issue before copying its attachment link':undefined} onClick={()=>{void navigator.clipboard.writeText(attachmentLink(file,location.href)).then(()=>setNotice('Link copied')).catch(()=>setNotice('Could not copy link'));}}><Icon name="link"/></button><a aria-label={`Download ${file.name}`} href={file.url.startsWith('/api/')?`${file.url}?download=1`:file.url} download={file.name}><Icon name="download"/></a></div>
  {notice&&<span role="status" className="file-media-notice">{notice}</span>}
 </div>;
}
