import { expect,test } from "bun:test";
import { EditorState } from "prosemirror-state";
import { fromEditorDocument, richSchema, toEditorDocument, type AdfDocument } from "./rich-document";

export const richFixture:AdfDocument={type:"doc",version:1,content:[
  {type:"heading",attrs:{level:2,localId:"heading-id"},content:[{type:"text",text:"A formatted document"}]},
  {type:"paragraph",attrs:{localId:"paragraph-id"},content:[{type:"text",text:"Formatted text",marks:[{type:"link",attrs:{href:"https://example.com",title:"Example"}},{type:"strong"},{type:"em"},{type:"textColor",attrs:{color:"#ff0000"}},{type:"unfamiliarMark",attrs:{value:42}}]},{type:"hardBreak"},{type:"mention",attrs:{id:"user-id",text:"A person",accessLevel:"CONTAINER"}}]},
  {type:"bulletList",content:[{type:"listItem",content:[{type:"paragraph",content:[{type:"text",text:"A list item"}]}]}]},
  {type:"orderedList",attrs:{order:3},content:[{type:"listItem",content:[{type:"paragraph",content:[{type:"text",text:"A numbered item"}]}]}]},
  {type:"codeBlock",attrs:{language:"typescript"},content:[{type:"text",text:"const value = 1;\nconsole.log(value);"}]},
  {type:"table",attrs:{isNumberColumnEnabled:true,layout:"wide",localId:"table-id"},content:[{type:"tableRow",content:[{type:"tableHeader",attrs:{colspan:1,rowspan:1,colwidth:[180],background:"#eeeeee"},content:[{type:"paragraph",content:[{type:"text",text:"Header"}]}]},{type:"tableCell",content:[{type:"paragraph",content:[{type:"text",text:"Cell"}]}]}]}]},
  {type:"taskList",attrs:{localId:"tasks"},content:[{type:"taskItem",attrs:{localId:"task-id",state:"DONE"},content:[{type:"text",text:"Keep this task"}]}]},
  {type:"mediaSingle",attrs:{layout:"center"},content:[{type:"media",attrs:{id:"attachment-id",type:"file",collection:"private"}}]},
  {type:"extension",attrs:{extensionType:"unknown-app",parameters:{nested:{keep:true}}}},
]};

test("rich Jira documents round-trip without flattening marks, tables, IDs, or unknown content",()=>{
  const editor=toEditorDocument(richFixture);editor.check();
  expect(fromEditorDocument(editor)).toEqual(richFixture);
});
test("editing formatted text preserves unrelated rich branches and opaque content",()=>{
  const state=EditorState.create({schema:richSchema,doc:toEditorDocument(richFixture)});
  let position=0;state.doc.descendants((node,pos)=>{if(node.isText&&node.text==="Formatted text")position=pos;});
  const next=state.apply(state.tr.insertText(" updated",position+9));
  const result=fromEditorDocument(next.doc);
  expect(result.content?.slice(2)).toEqual(richFixture.content?.slice(2));
  expect(result.content?.[1]?.attrs).toEqual({localId:"paragraph-id"});
  expect(JSON.stringify(result)).toContain("Formatted updated text");
  expect(result.content?.[1]?.content?.[0]?.marks).toEqual(richFixture.content?.[1]?.content?.[0]?.marks);
});
test("legacy plain descriptions and empty descriptions remain editable",()=>{
  expect(fromEditorDocument(toEditorDocument("First\nline\n\nSecond")).content).toHaveLength(2);
  expect(fromEditorDocument(toEditorDocument(null))).toEqual({type:"doc",version:1,content:[]});
});
