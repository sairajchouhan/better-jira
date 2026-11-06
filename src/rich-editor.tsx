import { useEffect, useRef, useState } from "react";
import { EditorState, type Command } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import "prosemirror-view/style/prosemirror.css";
import { baseKeymap, chainCommands, lift, toggleMark, wrapIn } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { history, redo, undo } from "prosemirror-history";
import { liftListItem, sinkListItem, splitListItem, wrapInList } from "prosemirror-schema-list";
import { addColumnAfter, addRowAfter, deleteTable, goToNextCell, isInTable, tableEditing } from "prosemirror-tables";
import { fromEditorDocument, richSchema, safeLink, toEditorDocument, type AdfDocument } from "./rich-document";

export type RichEditorProps={initial:unknown;label?:string;id?:string;autoFocus?:boolean;expanded?:boolean;onChange?:(doc:AdfDocument)=>void;onSave?:(doc:AdfDocument)=>void;onCancel?:()=>void};
const BUTTON="rounded px-2 py-1 text-[12px] text-fg-2 hover:bg-hover disabled:opacity-30 aria-pressed:bg-sel";

export function RichEditor(props:RichEditorProps) {
  const host=useRef<HTMLDivElement>(null),view=useRef<EditorView|null>(null),latest=useRef(props);latest.current=props;
  const [,refresh]=useState(0),[linkOpen,setLinkOpen]=useState(false),[url,setURL]=useState("");
  const [linkError,setLinkError]=useState("");
  const save=()=>{if(view.current)latest.current.onSave?.(fromEditorDocument(view.current.state.doc));};
  useEffect(()=>{
    const editor=new EditorView(host.current!,{
      state:EditorState.create({schema:richSchema,doc:toEditorDocument(latest.current.initial),plugins:[history(),keymap({
        "Mod-z":undo,"Mod-Shift-z":redo,"Mod-y":redo,
        "Mod-b":toggleMark(richSchema.marks.strong!),"Mod-i":toggleMark(richSchema.marks.em!),"Mod-u":toggleMark(richSchema.marks.underline!),
        "Mod-k":()=>{setLinkOpen(true);return true;},
        "Mod-Enter":()=>{if(!latest.current.onSave)return false;save();return true;},
        "Escape":()=>{if(!latest.current.onCancel)return false;latest.current.onCancel();return true;},
        "Enter":chainCommands(splitListItem(richSchema.nodes.listItem!),baseKeymap.Enter!),
        "Tab":chainCommands(goToNextCell(1),sinkListItem(richSchema.nodes.listItem!)),
        "Shift-Tab":chainCommands(goToNextCell(-1),liftListItem(richSchema.nodes.listItem!)),
      }),keymap(baseKeymap),tableEditing()]}),
      attributes:{role:"textbox","aria-label":props.label??"Issue description","aria-multiline":"true",id:props.id??"",class:"rich-content"},
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
  const insertTable:Command=(state,dispatch)=>{
    const cell=()=>richSchema.nodes.tableCell!.createAndFill()!;
    const row=()=>richSchema.nodes.tableRow!.create(null,[cell(),cell()]);
    const table=richSchema.nodes.table!.create(null,[row(),row()]);
    dispatch?.(state.tr.replaceSelectionWith(table).scrollIntoView());return true;
  };
  const addLink=()=>{
    const href=safeLink(url);
    if(!href){setLinkError("Enter an http, https, or mailto link.");return;}
    run((state,dispatch)=>{
      const tr=state.tr,mark=richSchema.marks.link!.create({href});
      if(state.selection.empty)tr.replaceSelectionWith(richSchema.text(href,[mark]));else tr.addMark(state.selection.from,state.selection.to,mark);
      dispatch?.(tr);return true;
    });setLinkOpen(false);setURL("");setLinkError("");
  };
  const inTable=!!view.current&&isInTable(view.current.state);
  return <div className="rich-editor mb-3 overflow-hidden rounded-lg border border-line-2 bg-card" data-expanded={props.expanded||undefined}>
    <div role="toolbar" aria-label="Description formatting" className="flex flex-wrap items-center gap-0.5 border-b border-line-2 p-1" onMouseDown={e=>{if((e.target as HTMLElement).closest("button"))e.preventDefault();}}>
      {[["strong","Bold","B"],["em","Italic","I"],["underline","Underline","U"],["strike","Strikethrough","S"],["code","Inline code","<>"]].map(([name,label,text])=><button key={name} type="button" aria-label={label} title={label} aria-pressed={marked(name!)} className={BUTTON} onClick={()=>run(toggleMark(richSchema.marks[name!]!))}>{text}</button>)}
      <select aria-label="Text style" className="rounded bg-card px-1 py-1 text-[12px] outline-none" value={view.current?.state.selection.$from.parent.type.name==="heading"?String(view.current.state.selection.$from.parent.attrs.level):"paragraph"} onChange={e=>changeBlock(e.target.value==="paragraph"?"paragraph":"heading",e.target.value==="paragraph"?{}:{level:Number(e.target.value)})}><option value="paragraph">Text</option>{[1,2,3].map(n=><option key={n} value={n}>Heading {n}</option>)}</select>
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
    <div ref={host}/>
    {(props.onSave||props.onCancel)&&<div className="flex items-center justify-end gap-2 border-t border-line-2 p-2 text-[12px]"><span className="mr-auto text-fg-3">⌘↵ save · Esc cancel</span>{props.onCancel&&<button type="button" className={BUTTON} onClick={props.onCancel}>Cancel</button>}{props.onSave&&<button type="button" className="rounded bg-accent px-3 py-1 text-white" onClick={save}>Save description</button>}</div>}
  </div>;
}
