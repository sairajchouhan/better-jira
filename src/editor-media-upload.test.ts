import {expect,test} from 'bun:test';
import {EditorState,TextSelection} from 'prosemirror-state';
import type {EditorView} from 'prosemirror-view';
import {mediaUploads} from './editor-media-upload';
import {fromEditorDocument,richSchema,toEditorDocument} from './rich-document';
import type {Attachment} from './attachment-media';
test('a pending local upload follows typing and inserts at its mapped position',async()=>{
 let finish!:(files:Attachment[])=>void;
 const pending=new Promise<Attachment[]>(resolve=>{finish=resolve;});
 let state:EditorState;const view={get state(){return state;},dispatch(tr:any){state=state.apply(tr);}} as EditorView;
 const uploads=mediaUploads(()=>view,()=>pending);
 state=EditorState.create({schema:richSchema,doc:toEditorDocument('abc'),plugins:[uploads.plugin]});
 state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,2)));
 uploads.enqueue([new File(['content'],'example.txt')]);
 view.dispatch(state.tr.insertText('X',1));
 finish([{id:'local-media',name:'example.txt',url:'blob:local',type:'text/plain',size:7}]);
 await new Promise(resolve=>setTimeout(resolve,0));
 const doc=fromEditorDocument(state.doc);
 expect(doc.content?.[0]?.content?.[0]?.text).toBe('Xa');
 expect(doc.content?.[1]?.content?.[0]?.attrs?.id).toBe('local-media');
 expect(doc.content?.[2]?.content?.[0]?.text).toBe('bc');uploads.dispose();
});

test('forward Delete beside a pending upload cannot strand the send guard',async()=>{
 let finish!:(files:Attachment[])=>void;let state:EditorState;const busy:boolean[]=[];
 const view={get state(){return state;},dispatch(tr:any){state=state.apply(tr);}} as EditorView;
 const uploads=mediaUploads(()=>view,()=>new Promise(resolve=>{finish=resolve;}),value=>busy.push(value));
 state=EditorState.create({schema:richSchema,doc:toEditorDocument('hello world'),plugins:[uploads.plugin]});
 uploads.enqueue([new File(['note'],'note.txt')],1);view.dispatch(state.tr.delete(1,2));
 finish([{id:'note',name:'note.txt',url:'blob:note',type:'text/plain',size:4}]);await new Promise(resolve=>setTimeout(resolve,0));
 expect(uploads.busy()).toBe(false);expect(busy.at(-1)).toBe(false);
 expect(JSON.stringify(fromEditorDocument(state.doc))).toContain('note');uploads.dispose();
});

test('a removed insertion point clears a failed upload job and reports its failure',async()=>{
 let fail!:(error:Error)=>void;let state:EditorState;const notices:string[]=[];
 const view={get state(){return state;},dispatch(tr:any){state=state.apply(tr);}} as EditorView;
 const uploads=mediaUploads(()=>view,()=>new Promise((_,reject)=>{fail=reject;}),()=>{},message=>notices.push(message));
 state=EditorState.create({schema:richSchema,doc:toEditorDocument('hello world'),plugins:[uploads.plugin]});
 uploads.enqueue([new File(['note'],'note.txt')],4);view.dispatch(state.tr.delete(0,state.doc.content.size));
 fail(new Error('Storage unavailable'));await new Promise(resolve=>setTimeout(resolve,0));
 expect(uploads.busy()).toBe(false);expect(notices.join(' ')).toContain('Storage unavailable');uploads.dispose();
});

test('a removed insertion point clears a successful upload job and reports where the file was saved',async()=>{
 let finish!:(files:Attachment[])=>void;let state:EditorState;const notices:string[]=[];const busy:boolean[]=[];
 const view={get state(){return state;},dispatch(tr:any){state=state.apply(tr);}} as EditorView;
 const uploads=mediaUploads(()=>view,()=>new Promise(resolve=>{finish=resolve;}),value=>busy.push(value),message=>notices.push(message));
 state=EditorState.create({schema:richSchema,doc:toEditorDocument('hello world'),plugins:[uploads.plugin]});uploads.enqueue([new File(['note'],'note.txt')],4);view.dispatch(state.tr.delete(0,state.doc.content.size));
 finish([{id:'note',name:'note.txt',url:'blob:note',type:'text/plain',size:4}]);await new Promise(resolve=>setTimeout(resolve,0));
 expect(uploads.busy()).toBe(false);expect(busy.at(-1)).toBe(false);expect(notices.join(' ')).toContain('Files saved to issue attachments');uploads.dispose();
});
