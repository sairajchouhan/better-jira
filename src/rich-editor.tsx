import { useEffect, useRef, useState } from "react";
import { EditorState, type Command } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import "prosemirror-view/style/prosemirror.css";
import { baseKeymap, chainCommands, lift, toggleMark, wrapIn } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { history, redo, undo } from "prosemirror-history";
import { liftListItem, sinkListItem, splitListItem, wrapInList } from "prosemirror-schema-list";
import { addColumnAfter, addRowAfter, deleteTable, isInTable, tableEditing } from "prosemirror-tables";
import { codeDown, codeEnter, insertLink, insertTable, markdownRules, shiftTab, tab } from "./editor-commands";
import { fromEditorDocument, richSchema, safeLink, toEditorDocument, type AdfDocument } from "./rich-document";

/** inline: no frame, like Linear's description; every editor shows its formatting toolbar floating above it only while focused. */
export type RichEditorProps={initial:unknown;label?:string;id?:string;autoFocus?:boolean;expanded?:boolean;inline?:boolean;placeholder?:string;saveLabel?:string;hint?:string;onChange?:(doc:AdfDocument)=>void;onBlur?:(doc:AdfDocument)=>void;onSave?:(doc:AdfDocument)=>void;onCancel?:()=>void};
const BUTTON="shrink-0 whitespace-nowrap rounded px-2 py-1 text-[12px] text-fg-2 hover:bg-hover disabled:opacity-30 aria-pressed:bg-sel";

export function RichEditor(props:RichEditorProps) {
  const host=useRef<HTMLDivElement>(null),view=useRef<EditorView|null>(null),latest=useRef(props);latest.current=props;
  const [,refresh]=useState(0),[linkOpen,setLinkOpen]=useState(false),[url,setURL]=useState("");
  const [linkError,setLinkError]=useState("");
  const save=()=>{if(view.current)latest.current.onSave?.(fromEditorDocument(view.current.state.doc));};
  useEffect(()=>{
    const editor=new EditorView(host.current!,{
      state:EditorState.create({schema:richSchema,doc:toEditorDocument(latest.current.initial),plugins:[markdownRules,history(),keymap({
        "Mod-z":undo,"Mod-Shift-z":redo,"Mod-y":redo,
        "Mod-b":toggleMark(richSchema.marks.strong!),"Mod-i":toggleMark(richSchema.marks.em!),"Mod-u":toggleMark(richSchema.marks.underline!),
        "Mod-k":()=>{setLinkOpen(true);return true;},
        "Mod-Enter":()=>{if(!latest.current.onSave)return false;save();return true;},
        "Escape":()=>{if(!latest.current.onCancel)return false;latest.current.onCancel();return true;},
        "Enter":chainCommands(codeEnter,splitListItem(richSchema.nodes.listItem!),baseKeymap.Enter!),
        "ArrowDown":codeDown,
        "Tab":tab,
        "Shift-Tab":shiftTab,
      }),keymap(baseKeymap),tableEditing()]}),
      attributes:{role:"textbox","aria-label":props.label??"Issue description","aria-multiline":"true",id:props.id??"",class:"rich-content"},
      handleDOMEvents:{blur:editor=>{latest.current.onBlur?.(fromEditorDocument(editor.state.doc));return false;}},
      dispatchTransaction(tr){const next=editor.state.apply(tr);editor.updateState(next);refresh(n=>n+1);if(tr.docChanged)latest.current.onChange?.(fromEditorDocument(next.doc));},
    });
    view.current=editor;
    if(props.autoFocus)editor.focus();
    return()=>{editor.destroy();view.current=null;};
  },[]);
  const run=(command:Command)=>{const editor=view.current;if(editor){command(editor.state,editor.dispatch,editor);editor.focus();}};
  const marked=(name:string)=>{const state=view.current?.state;return !!state&&(state.storedMarks??state.selection.$from.marks()).some(m=>m.type.name===name);};
  const changeBlock=(type:string,attributes:Record<string,unknown>={})=>run((state,dispatch)=>{
    const nodeType=richSchema.nodes[type]!;let changed=false;const tr=state.tr;
    state.doc.nodesBetween(state.selection.from,state.selection.to,(node,pos)=>{
      if(node.isTextblock&&nodeType.validContent(node.content)){tr.setNodeMarkup(pos,nodeType,{...node.attrs,...attributes},node.marks);changed=true;return false;}
    });
    if(changed)dispatch?.(tr);return changed;
  });
  const list=(name:"bulletList"|"orderedList")=>run((state,dispatch,editor)=>{
    for(let d=state.selection.$from.depth;d>0;d--)if(state.selection.$from.node(d).type.name===name)return liftListItem(richSchema.nodes.listItem!)(state,dispatch,editor);
    return wrapInList(richSchema.nodes[name]!)(state,dispatch,editor);
  });
  const addLink=()=>{
    const href=safeLink(url);
    if(!href){setLinkError("Enter an http, https, or mailto link.");return;}
    run(insertLink(href));setLinkOpen(false);setURL("");setLinkError("");
  };
  const inTable=!!view.current&&isInTable(view.current.state);
  const doc=view.current?.state.doc,empty=!doc||doc.childCount===1&&doc.firstChild!.isTextblock&&!doc.firstChild!.content.size;
  const level=view.current?.state.selection.$from.parent.type.name==="heading"?Number(view.current.state.selection.$from.parent.attrs.level):0;
  return <div className={`rich-editor group/editor relative ${props.inline?"":"mb-3 rounded-lg border border-line-2 bg-card"}`} data-inline={props.inline||undefined} data-expanded={props.expanded||undefined}>
    <div role="toolbar" aria-label="Description formatting" className="absolute right-0 bottom-full z-10 mb-1 hidden max-w-full flex-nowrap items-center gap-0.5 overflow-x-auto rounded-lg border border-line-2 bg-card p-1 shadow-lg group-focus-within/editor:flex" onMouseDown={e=>{if((e.target as HTMLElement).closest("button"))e.preventDefault();}}>
      {[["strong","Bold","B"],["em","Italic","I"],["underline","Underline","U"],["strike","Strikethrough","S"],["code","Inline code","<>"]].map(([name,label,text])=><button key={name} type="button" aria-label={label} title={label} aria-pressed={marked(name!)} className={BUTTON} onClick={()=>run(toggleMark(richSchema.marks[name!]!))}>{text}</button>)}
      {[0,1,2,3].map(n=><button key={n} type="button" aria-label={n?`Heading ${n}`:"Text"} title={n?`Heading ${n}`:"Text"} aria-pressed={level===n} className={`${BUTTON} shrink-0`} onClick={()=>changeBlock(n?"heading":"paragraph",n?{level:n}:{})}>{n?`H${n}`:"T"}</button>)}
      <button type="button" aria-label="Bulleted list" className={BUTTON} onClick={()=>list("bulletList")}>• List</button>
      <button type="button" aria-label="Numbered list" className={BUTTON} onClick={()=>list("orderedList")}>1. List</button>
      <button type="button" aria-label="Block quote" className={BUTTON} onClick={()=>run(wrapIn(richSchema.nodes.blockquote!))}>Quote</button>
      <button type="button" aria-label="Code block" className={BUTTON} onClick={()=>changeBlock("codeBlock")}>Code</button>
      <button type="button" aria-label="Insert link" className={BUTTON} onClick={()=>{const state=view.current?.state;const current=state&&(state.storedMarks??state.selection.$from.marks()).find(m=>m.type.name==="link");setURL(current?.attrs.href??"");setLinkOpen(!linkOpen);}}>Link</button>
      {marked("link")&&<button type="button" aria-label="Remove text link" className={BUTTON} onClick={()=>run(toggleMark(richSchema.marks.link!))}>Unlink</button>}
      <button type="button" aria-label="Insert table" className={BUTTON} onClick={()=>run(insertTable)}>Table</button>
      {inTable&&<><button type="button" aria-label="Add table row" className={BUTTON} onClick={()=>run(addRowAfter)}>+ Row</button><button type="button" aria-label="Add table column" className={BUTTON} onClick={()=>run(addColumnAfter)}>+ Column</button><button type="button" aria-label="Remove table" className={BUTTON} onClick={()=>run(deleteTable)}>Remove table</button></>}
      <button type="button" aria-label="Undo description edit" className={BUTTON} onClick={()=>run(undo)}>Undo</button><button type="button" aria-label="Redo description edit" className={BUTTON} onClick={()=>run(redo)}>Redo</button>
    </div>
    {linkOpen&&<div className="flex flex-wrap items-center gap-2 border-b border-line-2 p-2"><input autoFocus aria-label="Text link URL" value={url} onChange={e=>setURL(e.target.value)} className="min-w-0 flex-1 rounded border border-line-2 px-2 py-1 outline-none" onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();e.stopPropagation();addLink();}if(e.key==="Escape"){e.preventDefault();e.stopPropagation();setLinkOpen(false);view.current?.focus();}}}/><button type="button" className={BUTTON} onClick={addLink}>Apply link</button>{linkError&&<span role="alert" className="w-full text-[12px] text-fg-3">{linkError}</span>}</div>}
    <div className="relative">{empty&&props.placeholder&&<p aria-hidden className="rich-placeholder pointer-events-none absolute text-fg-4">{props.placeholder}</p>}<div ref={host}/></div>
    {(props.onSave||props.onCancel)&&<div className="flex items-center justify-end gap-2 border-t border-line-2 p-2 text-[12px]"><span className="mr-auto text-fg-3">{props.hint??"⌘↵ save · Esc cancel"}</span>{props.onCancel&&<button type="button" className={BUTTON} onClick={props.onCancel}>Cancel</button>}{props.onSave&&<button type="button" className="rounded bg-accent px-3 py-1 text-white" onClick={save}>{props.saveLabel??"Save description"}</button>}</div>}
  </div>;
}
