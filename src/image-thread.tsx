import {useRef,useState,type Dispatch,type ReactNode,type SetStateAction} from 'react';
import {useHotkeys} from '@tanstack/react-hotkeys';
import type {ImageComment} from './media-edits';
import {ActionMenu} from './action-menu';
import {Confirm} from './menu-surface';
import {Icon} from './icons';
export type ImageThreadDraft={text:string;editing?:string;beforeEdit?:string};
export function ImageThread({comments,author,save,close,draft,setDraft}:{draft:ImageThreadDraft;setDraft:Dispatch<SetStateAction<ImageThreadDraft>>;comments:ImageComment[];author:string;save:(comments:ImageComment[])=>void;close:()=>void}){
 const form=useRef<HTMLFormElement>(null),root=useRef<HTMLDivElement>(null);
 const {text,editing}=draft;
 const setText=(text:string)=>setDraft(value=>({...value,text})),setEditing=(editing:string|undefined)=>setDraft(value=>({...value,editing}));
 const [menu,setMenu]=useState<string>(),[notice,setNotice]=useState('');
 useHotkeys([{hotkey:'Mod+Enter',callback:()=>form.current?.requestSubmit()},{hotkey:'Escape',callback:close}],{target:root,capture:true,ignoreInputs:false});
 return <div ref={root} className="image-comment-thread" onMouseDown={event=>event.stopPropagation()}><div aria-label="Comment thread on image">{comments.map(comment=><div key={comment.id} data-image-comment={comment.id}><div className="image-comment-meta"><span>{comment.author}</span><time title={new Date(comment.at).toLocaleString()} dateTime={comment.at}>{new Date(comment.at).toLocaleDateString()}</time><button aria-label="Image comment options" onClick={()=>setMenu(menu===comment.id?undefined:comment.id)}>···</button></div>{menu===comment.id&&<div role="menu"><button role="menuitem" onClick={()=>{if(!editing)setDraft(value=>({...value,beforeEdit:text}));setEditing(comment.id);setText(comment.text);setNotice('');setMenu(undefined);root.current?.querySelector('textarea')?.focus();}}>Edit image comment</button><button role="menuitem" onClick={()=>{save(comments.filter(c=>c.id!==comment.id));if(editing===comment.id){setEditing(undefined);setNotice('Comment deleted. Your draft is kept as a new comment.');}setMenu(undefined);requestAnimationFrame(()=>root.current?.querySelector('textarea')?.focus());}}>Delete image comment</button></div>}<p>{comment.text}</p></div>)}</div>
 {notice&&<p role="status">{notice}</p>}
 <form ref={form} onSubmit={event=>{event.preventDefault();if(!text.trim())return;save(editing&&comments.some(c=>c.id===editing)?comments.map(c=>c.id===editing?{...c,text:text.trim()}:c):[...comments,{id:crypto.randomUUID(),text:text.trim(),author,at:new Date().toISOString()}]);setText('');setEditing(undefined);setNotice('');root.current?.querySelector('textarea')?.focus();}}><span className="image-comment-avatar" aria-hidden="true">{author[0]}</span><textarea autoFocus aria-label="Image comment" value={text} onChange={event=>setText(event.target.value)} placeholder="Add a comment…"/><button disabled={!text.trim()} aria-label={editing?'Save image comment':'Submit image comment'}>↑</button></form>{editing&&<button onClick={()=>{setEditing(undefined);setText(draft.beforeEdit??'');root.current?.querySelector('textarea')?.focus();}}>Cancel edit</button>}</div>;
}
/** An image's comments in Activity form one thread, like Linear's: replies, edit and delete work even after the image leaves the description. */
export function ImageCommentCard({comments,src,head,me,author,view,save}:{comments:ImageComment[];src?:string;head:(comment:ImageComment)=>ReactNode;me:ReactNode;author:string;view:()=>void;save:(comments:ImageComment[])=>void}){
 const [menu,setMenu]=useState<{anchor:HTMLElement;id:string}>(),[editing,setEditing]=useState<string>(),[deleting,setDeleting]=useState<string>(),[text,setText]=useState(''),[reply,setReply]=useState('');
 const root=useRef<HTMLLIElement>(null),done=(id:string)=>{setEditing(undefined);requestAnimationFrame(()=>root.current?.querySelector<HTMLElement>(`#image-comment-${CSS.escape(id)} [aria-label="Comment options"]`)?.focus());};
 const send=()=>{if(!reply.trim())return;save([...comments,{id:crypto.randomUUID(),text:reply.trim(),author,at:new Date().toISOString()}]);setReply('');};
 return <li ref={root} data-image-thread className="comment-thread rounded-lg bg-card">
  {src&&<img data-image-comment-thumbnail alt="" src={src} className="mx-3 mt-2.5 h-[100px] max-w-[178px] rounded object-cover"/>}
  {comments.map((comment,i)=><div key={comment.id} id={`image-comment-${comment.id}`} className={`comment-message ${i?'comment-reply':''}`}>
   <div className="comment-head">{head(comment)}<span className="ml-auto flex"><button aria-label="Comment options" title="Comment options" aria-expanded={menu?.id===comment.id} className="comment-hover-action" onClick={e=>setMenu({anchor:e.currentTarget,id:comment.id})}><Icon name="dots" size={14}/></button></span></div>
   {editing===comment.id?<form onSubmit={e=>{e.preventDefault();if(text.trim()){save(comments.map(c=>c.id===comment.id?{...c,text:text.trim()}:c));done(comment.id);}}} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();done(comment.id);}}}><textarea autoFocus aria-label="Edit image comment" value={text} onChange={e=>setText(e.target.value)} className="mt-1.5 w-full resize-none rounded border border-line-2 bg-transparent p-1.5 outline-none"/><div className="flex justify-end gap-2 text-[12px]"><button type="button" onClick={()=>done(comment.id)}>Cancel</button><button disabled={!text.trim()}>Save</button></div></form>:<p className="comment-body">{comment.text}</p>}
  </div>)}
  <button className="mx-3 text-[12px] text-accent" onClick={view}>View image</button>
  <div className="comment-reply-composer"><form className="comment-reply-row" onSubmit={e=>{e.preventDefault();send();}}>{me}<textarea rows={1} aria-label="Reply to image thread" placeholder="Leave a reply…" value={reply} onChange={e=>setReply(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();send();}}} className="min-w-0 flex-1 resize-none bg-transparent outline-none"/><button aria-label="Submit image reply" title="Submit reply (⌘↵)" className="comment-reply-send" disabled={!reply.trim()}><Icon name="up" size={14}/></button></form></div>
  {menu&&<ActionMenu label="Comment options" anchor={menu.anchor} align="end" close={()=>setMenu(undefined)} entries={[{name:'Edit',icon:'pencil',run:()=>{setText(comments.find(c=>c.id===menu.id)?.text??'');setEditing(menu.id);}},{name:'Delete',icon:'trash',divider:true,danger:true,run:()=>setDeleting(menu.id)}]}/>}
  {deleting&&<Confirm title="Delete this comment?" detail="You cannot undo this action." action="Delete" onConfirm={()=>{setDeleting(undefined);save(comments.filter(c=>c.id!==deleting));}} close={()=>setDeleting(undefined)}/>}
 </li>;
}
