import {lazy,Suspense,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useHotkeys} from '@tanstack/react-hotkeys';
import type {Attachment} from './attachment-media';
import {Icon} from './icons';
import {actions,ME,useStore} from './store';
import {ImageThread,type ImageThreadDraft} from './image-thread';
import type {ImageCrop} from './media-edits';
const Viewer=lazy(()=>import('./image-viewer').then(module=>({default:module.ImageViewer})));
export async function imageBlob(url:string,crop?:ImageCrop,signal?:AbortSignal){
 const response=await fetch(url,{credentials:url.startsWith('/api/')?'same-origin':'omit',referrerPolicy:'no-referrer',signal});
 if(!response.ok)throw new Error('Could not read the image');
 const bitmap=await createImageBitmap(await response.blob());
 try{const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*(crop?.width??1)));canvas.height=Math.max(1,Math.round(bitmap.height*(crop?.height??1)));canvas.getContext('2d')!.drawImage(bitmap,(crop?.x??0)*bitmap.width,(crop?.y??0)*bitmap.height,bitmap.width*(crop?.width??1),bitmap.height*(crop?.height??1),0,0,canvas.width,canvas.height);
 const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not copy image')),'image/png'));
 return blob;
 }finally{bitmap.close();}
}
export async function copyMediaImage(url:string){await navigator.clipboard.write([new ClipboardItem({'image/png':await imageBlob(url)})]);}
export function ImageMedia({file,external,issueKey,onSize,onError,onSelect}:{onSelect?:()=>void;issueKey?:string;file:Attachment;external:boolean;onSize:(size:{width:number;height:number})=>void;onError:()=>void}){
 const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),commentTrigger=useRef<HTMLButtonElement>(null),readProbe=useRef<AbortController|undefined>(undefined);
 const [readAccess,setReadAccess]=useState(external?'unknown':'allowed');
 useEffect(()=>()=>readProbe.current?.abort(),[]);
 const checkReadAccess=()=>{if(!external||readProbe.current)return;const controller=new AbortController();readProbe.current=controller;setReadAccess('checking');const timer=setTimeout(()=>controller.abort(),5000);void imageBlob(file.url,undefined,controller.signal).then(()=>setReadAccess('allowed')).catch(()=>{if(root.current)setReadAccess('denied');}).finally(()=>clearTimeout(timer));};
 const editable=readAccess==='allowed',readReason=readAccess==='checking'?'Checking image editing access…':'This external source cannot be read for copying or cropping.';
 const id=file.mediaId??file.id,edit=useStore(state=>state.issues.get(issueKey??'')?.mediaEdits?.[id]);
 const [displayURL,setDisplayURL]=useState(file.url),[mode,setMode]=useState<'preview'|'crop'>('preview'),[thread,setThread]=useState(false),[threadDraft,setThreadDraft]=useState<ImageThreadDraft>({text:''});
 const displayFile={...file,url:displayURL};
 useEffect(()=>{let live=true,url:string|undefined;setDisplayURL(file.url);if(edit?.crop)void imageBlob(file.url,edit.crop).then(blob=>{url=URL.createObjectURL(blob);if(live)setDisplayURL(url);else URL.revokeObjectURL(url);}).catch(()=>setNotice('Could not load the cropped image'));return()=>{live=false;if(url)URL.revokeObjectURL(url);};},[file.url,JSON.stringify(edit?.crop)]);
 const [selected,setSelected]=useState(false),[open,setOpen]=useState(false),[notice,setNotice]=useState('');
 const previousThread=useRef(false);
 useLayoutEffect(()=>{if(previousThread.current&&!thread)commentTrigger.current?.focus();previousThread.current=thread;},[thread]);
 useEffect(()=>{const frame=root.current?.closest('[data-media-id]');const show=()=>{setThread(true);setSelected(true);requestAnimationFrame(()=>root.current?.querySelector('textarea')?.focus());};frame?.addEventListener('show-image-comments',show);return()=>frame?.removeEventListener('show-image-comments',show);},[]);
 useEffect(()=>{const outside=(event:PointerEvent)=>{if(!open&&!root.current?.contains(event.target as Node))setSelected(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[open]);
 const owned=()=>!root.current?.querySelector('textarea:focus,input:focus,select:focus')&&selected&&(root.current?.contains(document.activeElement)||!!root.current?.closest('.ProseMirror-selectednode')&&document.activeElement===root.current.closest('.rich-content'));
 useHotkeys((['F','Space'] as const).map(hotkey=>({hotkey,callback:(event:KeyboardEvent)=>{if(!open&&owned()){event.preventDefault();event.stopPropagation();setMode('preview');setOpen(true);}},options:{enabled:selected&&!open}})),{capture:true,ignoreInputs:false,preventDefault:false,stopPropagation:false});
 return <div ref={root} className="image-media" data-image-selected={selected} onPointerEnter={checkReadAccess} onFocus={checkReadAccess}>
  <img data-attachment-id={file.id} alt={file.name} src={displayURL} loading="lazy" referrerPolicy="no-referrer" className="media-visual block w-full rounded-md" onMouseDown={event=>{if(onSelect){event.preventDefault();onSelect();}}} onClick={()=>setSelected(true)} onDoubleClick={()=>{setMode('preview');setOpen(true);}} onLoad={event=>onSize({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})} onError={onError}/>
  <div role="toolbar" aria-label="Image actions" className="image-actions">
   <button aria-label="Copy image" disabled={!editable} title={!editable?readReason:undefined} onClick={()=>{void copyMediaImage(displayURL).then(()=>setNotice('Image copied')).catch(()=>setNotice('Could not copy this image. Download it instead.'));}}><Icon name="copy"/></button>
   {issueKey&&<button aria-label="Crop image" disabled={!editable} title={!editable?readReason:undefined} onClick={()=>{setMode('crop');setOpen(true);}}><Icon name="crop"/></button>}
   <button ref={trigger} aria-label="Full screen" onClick={()=>{setMode('preview');setOpen(true);}}><Icon name="expand"/></button>
   {issueKey&&<button ref={commentTrigger} aria-label={thread?'Hide image comments':'Add image comment'} onClick={()=>{setSelected(true);setThread(value=>!value);}}><Icon name="comment"/></button>}
  </div>
  {thread&&issueKey&&<ImageThread draft={threadDraft} setDraft={setThreadDraft} comments={edit?.comments??[]} author={ME.name} save={comments=>actions.mediaEdit(issueKey,id,{...edit,comments})} close={()=>{setSelected(true);setThread(false);}}/>}
  {notice&&<span role="status" className="image-notice">{notice}</span>}
  {open&&<Suspense fallback={<div role="status">Opening preview…</div>}><Viewer issueKey={issueKey} editable={editable} readReason={readReason} file={displayFile} original={file} crop={edit?.crop} startCrop={mode==='crop'} onCrop={issueKey&&editable?async crop=>{await imageBlob(file.url,crop);actions.mediaEdit(issueKey,id,{...edit,crop});}:undefined} external={external} close={()=>{setSelected(true);setOpen(false);requestAnimationFrame(()=>{if(!document.querySelector('[cmdk-input]'))trigger.current?.focus();});}}/></Suspense>}
 </div>;
}
