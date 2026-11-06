import { expect,test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { emptyLocalState,LocalDatabase,parseLocalState,type LocalState } from "./local-data";
import type { Issue,Full } from "./store";

const issue:Issue={key:"TEST-NEW1",board:1,summary:"Persistent local issue",status:"todo",assignee:null,labels:["local"],comments:1,updated:"2026-11-06T10:00:00Z",resolved:null};
const full:Full={key:issue.key,fields:{description:{type:"doc",version:1,content:[{type:"paragraph",content:[{type:"text",text:"Rich text",marks:[{type:"strong"}]}]}]},comment:{total:1,comments:[{id:"local-2",body:{type:"doc",version:1,content:[{type:"paragraph",content:[{type:"text",text:"Local comment"}]}]}}]}}};
test("local files, rich descriptions, comments and undo/redo survive a database close/reopen",async()=>{
  const factory=new IDBFactory();let db=await LocalDatabase.open("account-one",factory);
  const file=await db.addFile(new File(["durable file content"],"fixture.txt",{type:"text/plain"}));
  const mediaEdits={fixture:{crop:{x:.1,y:.1,width:.7,height:.8},comments:[{id:'review',text:'Keep this crop',author:'Me',at:'2026-11-07T00:00:00Z'}]}};
  const savedIssue={...issue,attachments:[file],mediaEdits};
  const state:LocalState={version:1,sequence:2,changes:[{key:issue.key,issue:savedIssue,full,issueFields:["summary","attachments"],fullFields:["description","comment"],created:true}],undo:[{keys:[issue.key],label:"create",before:[{}],after:[{issue:savedIssue,full}]}],redo:[]};
  await db.save(state);const oldURL=file.url;db.close();
  db=await LocalDatabase.open("account-one",factory);const loaded=await db.load();
  expect(loaded.recovered).toBe(false);expect(loaded.state.sequence).toBe(2);expect(loaded.state.changes[0]?.full).toEqual(full);
  expect(loaded.state.undo[0]?.after[0]?.full).toEqual(full);
  expect(loaded.state.changes[0]?.issue?.mediaEdits).toEqual(mediaEdits);
  expect(loaded.state.undo[0]?.after[0]?.issue?.mediaEdits).toEqual(mediaEdits);
  const url=loaded.state.changes[0]?.issue?.attachments?.[0]?.url!;
  expect(url).not.toBe(oldURL);expect(await(await fetch(url)).text()).toBe("durable file content");
  expect(loaded.state.undo[0]?.after[0]?.issue?.attachments?.[0]?.url).toBe(url);
  db.close();
  const other=await LocalDatabase.open("another-account",factory);expect((await other.load()).state.changes).toEqual([]);other.close();
});
test("corrupt records are isolated and unknown schema versions cannot overwrite stored data",()=>{
  const state=emptyLocalState();
  expect(parseLocalState({...state,changes:[{key:"bad",issue:{reactions:{}},fullFields:[],issueFields:[],created:false}]})).toMatchObject({recovered:true,readOnly:false,state:{changes:[]}});
  expect(parseLocalState({version:99,changes:[issue]})).toMatchObject({recovered:true,readOnly:true});
  expect(parseLocalState(undefined)).toEqual({state,recovered:false,readOnly:false});
});

test("another tab cannot overwrite a newer revision",async()=>{
  const factory=new IDBFactory(),one=await LocalDatabase.open("same",factory),two=await LocalDatabase.open("same",factory);
  await one.load();await two.load();await one.save({...emptyLocalState(),sequence:7});
  await expect(two.save({...emptyLocalState(),sequence:8})).rejects.toThrow("Another tab saved newer");
  expect((await two.load()).state.sequence).toBe(7);one.close();two.close();
});
test("corrupt raw data is backed up and an unknown schema remains protected",async()=>{
  const factory=new IDBFactory(),name="better-jira:local:v1:corrupt",db=await LocalDatabase.open("corrupt",factory);db.close();
  const raw=await new Promise<IDBDatabase>(resolve=>{const request=factory.open(name);request.onsuccess=()=>resolve(request.result);});
  const put=(value:unknown)=>new Promise<void>((resolve,reject)=>{const tx=raw.transaction("state","readwrite");tx.objectStore("state").put(value,"workspace");tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});
  await put({...emptyLocalState(),changes:[{key:"bad",issue:{}}]});
  let current=await LocalDatabase.open("corrupt",factory);expect((await current.load()).recovered).toBe(true);expect(await current.recoveryCopies()).toHaveLength(1);current.close();
  await put({version:99,privateData:"keep me"});current=await LocalDatabase.open("corrupt",factory);
  expect((await current.load()).readOnly).toBe(true);await expect(current.save(emptyLocalState())).rejects.toThrow("unsupported version");
  expect((await current.recoveryCopies()).some((copy:any)=>copy.version===99&&copy.privateData==="keep me")).toBe(true);current.close();raw.close();
});

test('active local files keep their metadata but their blob URLs cannot render HTML or SVG',async()=>{
 const factory=new IDBFactory();let db=await LocalDatabase.open('safe-files',factory);
 for(const type of ['text/html','image/svg+xml']){
  const payload='<script>document.title="EXECUTED"</script>';
  const original=new File([payload],type==='text/html'?'active.html':'active.svg',{type});
  const file=await db.addFile(original);
  expect(file.type).toBe(original.type);expect(await(await fetch(file.url)).text()).toBe(payload);
  expect((await fetch(file.url)).headers.get('content-type')).toBe('application/octet-stream');
  db.close();db=await LocalDatabase.open('safe-files',factory);
  expect((await fetch((await db.fileURL(file.id))!)).headers.get('content-type')).toBe('application/octet-stream');
 }
 db.close();
});
