import {expect,test} from 'bun:test';
import {EditorState} from 'prosemirror-state';
import {history,undo} from 'prosemirror-history';
import {mediaCaretPlugin} from './media-caret';
import {richSchema,toEditorDocument,fromEditorDocument} from './rich-document';
test('typing beside media then undo restores the exact exported document',()=>{
 const doc=toEditorDocument({type:'doc',version:1,content:[{type:'mediaSingle',content:[{type:'media',attrs:{id:'one',type:'file'}}]}]});
 let state=EditorState.create({schema:richSchema,doc,plugins:[mediaCaretPlugin(),history()]});
 const before=fromEditorDocument(state.doc);state=state.applyTransaction(state.tr.insertText('x',1)).state;
 undo(state,tr=>{state=state.applyTransaction(tr).state;});expect(fromEditorDocument(state.doc)).toEqual(before);
});
test('caret paragraphs around adjacent media are editor-only until the user types in one',()=>{
 const doc={type:'doc' as const,version:1 as const,content:[{type:'mediaSingle',content:[{type:'media',attrs:{id:'one',type:'file'}}]},{type:'mediaSingle',content:[{type:'media',attrs:{id:'two',type:'file'}}]}]};
 const editor=toEditorDocument(doc);expect(editor.childCount).toBe(5);expect(fromEditorDocument(editor)).toEqual(doc);
 let state=EditorState.create({schema:richSchema,doc:editor,plugins:[mediaCaretPlugin()]});state=state.apply(state.tr.insertText('Caption',1));
 expect(fromEditorDocument(state.doc).content?.[0]?.content?.[0]?.text).toBe('Caption');expect(state.doc.firstChild?.attrs.mediaBoundary).toBe(false);
});

for(const container of ['blockquote','listItem','tableCell'])test(`media after text in ${container} accepts selection transactions losslessly`,()=>{
 const content=[{type:'paragraph',content:[{type:'text',text:'Text before media'}]},{type:'mediaSingle',content:[{type:'media',attrs:{type:'file',id:'nested'}}]}];
 const nested=container==='listItem'?{type:'bulletList',content:[{type:'listItem',content}]}:container==='tableCell'?{type:'table',content:[{type:'tableRow',content:[{type:'tableCell',content}]}]}:{type:'blockquote',content};
 const doc={type:'doc' as const,version:1 as const,content:[nested]};let state=EditorState.create({schema:richSchema,doc:toEditorDocument(doc),plugins:[mediaCaretPlugin()]});
 expect(()=>{state=state.apply(state.tr.setSelection(state.selection));}).not.toThrow();expect(fromEditorDocument(state.doc)).toEqual(doc);
});

test('dynamic top-level media acquire caret boundaries and deleting a boundary repairs it',()=>{
 const atom=(id:string)=>richSchema.nodes.mediaSingle!.create({raw:{type:'mediaSingle',content:[{type:'media',attrs:{id,type:'file'}}]}});
 let state=EditorState.create({schema:richSchema,doc:toEditorDocument('before'),plugins:[mediaCaretPlugin()]});
 state=state.apply(state.tr.insert(state.doc.content.size,[atom('one'),atom('two')]));
 const names:string[]=[];state.doc.forEach(node=>names.push(node.type.name));expect(names).toEqual(['paragraph','mediaSingle','paragraph','mediaSingle','paragraph']);
 let gap=0;state.doc.forEach((node,pos)=>{if(node.attrs.mediaBoundary&&!gap)gap=pos;});state=state.apply(state.tr.delete(gap,gap+2));
 const repaired:string[]=[];state.doc.forEach(node=>repaired.push(node.type.name));expect(repaired).toEqual(names);
 expect(fromEditorDocument(state.doc).content?.map(node=>node.type)).toEqual(['paragraph','mediaSingle','mediaSingle']);
});
