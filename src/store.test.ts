import { expect, test } from "bun:test";
import type { Board } from "./store";
import { IDBFactory } from "fake-indexeddb";

const storage=new Map<string,string>();
Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)}});
Object.defineProperty(globalThis,"requestAnimationFrame",{configurable:true,value:(callback:FrameRequestCallback)=>setTimeout(()=>callback(0),0)});
Object.defineProperty(globalThis,"indexedDB",{configurable:true,value:new IDBFactory()});
// Tests after load() navigate; give them a minimal browser location.
Object.defineProperty(globalThis,"location",{configurable:true,value:{href:"http://localhost:3000/",origin:"http://localhost:3000"}});
Object.defineProperty(globalThis,"history",{configurable:true,value:{pushState:(_s:unknown,_t:string,url:URL)=>{(globalThis as any).location.href=String(url);},replaceState:(_s:unknown,_t:string,url:URL)=>{(globalThis as any).location.href=String(url);}}});

test("personal issue edits, comments, creation and deletion undo without losing issue details",async()=>{
  const {actions,get,set,navigate,undoEdit,redoEdit,ME}=await import("./store");
  Object.assign(ME,{id:"me",name:"Me"});
  const board:Board={id:1,name:"Personal",columns:[{name:"Todo",statuses:[{id:"todo",name:"Todo",category:"new"}]},{name:"Done",statuses:[{id:"done",name:"Done",category:"done"}]}]};
  set({boards:[board],issues:new Map(),full:new Map()});navigate({board:1});
  const key=actions.create("Personal test",{status:"done",description:"Description",assignee:ME,priority:"High",labels:["test"],due:"2026-12-01"})!;
  expect(get().issues.get(key)).toMatchObject({status:"done",priority:"High",labels:["test"],assignee:ME,due:"2026-12-01"});
  expect(get().issues.get(key)?.resolved).toBeString();
  expect(get().full.get(key)?.fields.description.content[0].content[0].text).toBe("Description");
  actions.status(key,"todo");expect(get().issues.get(key)?.resolved).toBeNull();
  undoEdit();expect(get().issues.get(key)?.status).toBe("done");
  redoEdit();expect(get().issues.get(key)?.status).toBe("todo");
  actions.comment(key,"A local comment");expect(get().full.get(key)?.fields.comment.total).toBe(1);
  undoEdit();expect(get().full.get(key)?.fields.comment.total).toBe(0);expect(get().issues.get(key)?.comments).toBe(0);
  redoEdit();expect(get().full.get(key)?.fields.comment.total).toBe(1);
  actions.remove(key);expect(get().issues.has(key)).toBe(false);
  undoEdit();expect(get().issues.get(key)?.summary).toBe("Personal test");expect(get().full.get(key)?.fields.comment.total).toBe(1);
  const copy=actions.duplicate(key)!;expect(get().issues.get(copy)?.summary).toBe("Personal test (copy)");expect(get().issues.get(copy)?.labels).toEqual(["test"]);
  expect(get().full.get(copy)?.fields.comment.total).toBe(0);
  undoEdit();expect(get().issues.has(copy)).toBe(false);
  actions.patch(key,{priority:"Low"});expect(get().redoCount).toBe(0);
  const target=actions.create("Related target")!;
  actions.relate(key,target,"blocked");
  expect(get().issues.get(key)?.relations).toEqual([{key:target,kind:"blocked"}]);
  expect(get().issues.get(target)?.relations).toEqual([{key,kind:"blocking"}]);
  undoEdit();expect(get().issues.get(key)?.relations).toBeUndefined();expect(get().issues.get(target)?.relations).toBeUndefined();
  redoEdit();actions.relate(key,target,"blocked",true);
  expect(get().issues.get(key)?.relations).toEqual([]);expect(get().issues.get(target)?.relations).toEqual([]);
  actions.patch(target,{parent:key});actions.relate(key,target,"related");
  actions.remove(key);expect(get().issues.get(target)?.parent).toBeUndefined();expect(get().issues.get(target)?.relations).toEqual([]);
  undoEdit();expect(get().issues.get(target)?.parent).toBe(key);expect(get().issues.get(target)?.relations).toEqual([{key,kind:"related"}]);
  actions.patch(target,{parent:undefined});
  const beforeDrop=get().issues.get(target)!;
  actions.drop(target,1,[{by:"status",id:"Done"},{by:"assignee",id:ME.id}]);
  expect(get().issues.get(target)).toMatchObject({status:"done",assignee:ME});
  undoEdit();expect(get().issues.get(target)?.status).toBe(beforeDrop.status);expect(get().issues.get(target)?.assignee).toBe(beforeDrop.assignee);
  actions.drop(target,1,[{by:"priority",id:"High"},{by:"label",id:"ui"},{by:"label",id:"ui"}]);
  expect(get().issues.get(target)?.priority).toBe("High");expect(get().issues.get(target)?.labels).toEqual(["ui"]);
  actions.drop(target,1,[{by:"parent",id:key}]);actions.drop(key,1,[{by:"parent",id:target}]);expect(get().issues.get(key)?.parent).toBeUndefined();
  actions.drop(target,2,[{by:"status",id:"Done"}]);expect(get().issues.get(target)?.status).toBe(beforeDrop.status);
});

test("failed issue details expose an error and can be retried",async()=>{
  const {get,set,loadFull}=await import("./store");
  const key="REMOTE-1",template=[...get().issues.values()][0]!;
  const full=new Map(get().full);full.delete(key);set({full,issues:new Map(get().issues).set(key,{...template,key})});
  const original=globalThis.fetch;
  try {
    globalThis.fetch=Object.assign(async()=>new Response("unavailable",{status:503}),original);
    await loadFull(key);expect(get().fullErrors.get(key)).toBe("Could not load issue details");expect(get().full.has(key)).toBe(false);
    globalThis.fetch=Object.assign(async()=>Response.json({key,fields:{description:null,comment:{comments:[],total:0}}}),original);
    await loadFull(key);expect(get().full.has(key)).toBe(true);expect(get().fullErrors.get(key)).toBe("");
  }finally{globalThis.fetch=original;}
});

test("browser history restores issue selection without pushing another navigation",async()=>{
  const {get,navigate,load}=await import("./store");
  const issues=[...get().issues.values()],boards=get().boards;
  const [first,second]=issues;
  const keys=["location","history","window"] as const;
  const descriptors=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
  const originalFetch=globalThis.fetch;
  const page={href:"http://localhost:3000/?board=1"},entries=[page.href];let index=0;
  let popstate:(()=>void)|undefined;
  try {
    Object.defineProperty(globalThis,"location",{configurable:true,value:page});
    Object.defineProperty(globalThis,"history",{configurable:true,value:{
      pushState:(_state:unknown,_title:string,url:URL)=>{entries.splice(index+1);entries.push(String(url));index++;page.href=String(url);},
      replaceState:(_state:unknown,_title:string,url:URL)=>{entries[index]=String(url);page.href=String(url);},
    }});
    Object.defineProperty(globalThis,"window",{configurable:true,value:{addEventListener:(name:string,listener:()=>void)=>{if(name==="popstate")popstate=listener;}}});
    globalThis.fetch=Object.assign(async(input:string|URL|Request)=>Response.json(String(input)==="/api/client"?{site:"https://example.atlassian.net",user:{id:"me",name:"Me"}}:String(input)==="/api/boards"?boards:String(input)==="/api/issues"?issues:{entries:{},progress:{total:0,pending:0,completed:0,errors:0}}),originalFetch);
    await load();
    navigate({selected:first!.key,panel:true,view:"page"});navigate({selected:second!.key});
    expect(entries).toHaveLength(3);
    page.href=entries[--index]!;popstate!();
    expect(get().selected).toBe(first!.key);expect(get().panel).toBe(true);expect(get().view).toBe("page");expect(entries).toHaveLength(3);
    page.href=entries[++index]!;popstate!();expect(get().selected).toBe(second!.key);
    navigate({panel:false});expect(new URL(page.href).searchParams.has("issue")).toBe(false);
  }finally {
    globalThis.fetch=originalFetch;
    keys.forEach((key,i)=>{const descriptor=descriptors[i];if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);});
  }
});

test("I7: local comments can be rich, edited and deleted, each step undoable; Jira comments stay read-only",async()=>{
  const {actions,get,set,navigate,undoEdit,ME}=await import("./store");
  const board:Board={id:7,name:"Comments",columns:[{name:"Todo",statuses:[{id:"todo",name:"Todo",category:"new"}]}]};
  set({boards:[...get().boards,board]});navigate({board:7});
  const key=actions.create("Commented")!;
  const doc=(text:string)=>({type:"doc" as const,version:1 as const,content:[{type:"paragraph",content:[{type:"text",text,marks:[{type:"strong"}]}]}]});
  expect(actions.comment(key,doc("  "))).toBe(false);
  expect(actions.comment(key,doc("First"))).toBe(true);
  const id=get().full.get(key)!.fields.comment.comments[0].id;
  expect(get().full.get(key)!.fields.comment.comments[0].body.content[0].content[0].marks).toEqual([{type:"strong"}]);
  actions.editComment(key,id,doc("Edited"));
  expect(get().full.get(key)!.fields.comment.comments[0].body.content[0].content[0].text).toBe("Edited");
  undoEdit();expect(get().full.get(key)!.fields.comment.comments[0].body.content[0].content[0].text).toBe("First");
  actions.deleteComment(key,id);
  expect(get().full.get(key)!.fields.comment.total).toBe(0);expect(get().issues.get(key)!.comments).toBe(0);
  undoEdit();expect(get().full.get(key)!.fields.comment.comments.map((c:any)=>c.id)).toEqual([id]);
  const full=get().full.get(key)!;set({full:new Map(get().full).set(key,{...full,fields:{...full.fields,comment:{comments:[...full.fields.comment.comments,{id:"10001",body:doc("Jira")}],total:2}}})});
  actions.editComment(key,"10001",doc("Changed"));actions.deleteComment(key,"10001");
  expect(get().full.get(key)!.fields.comment.comments.at(-1).body.content[0].content[0].text).toBe("Jira");
  void ME;
});

test("R4: autosaved description edits within a minute make one history entry",async()=>{
  const {actions,get}=await import("./store");
  const key=actions.create("Described")!;
  for(const text of ["one","two","three"])actions.description(key,text);
  expect(get().issues.get(key)!.description).toBe("three");
  expect(get().issues.get(key)!.descriptionHistory?.length).toBe(1);
});

test("B5: creating stays on the board with a toast; duplicating opens the copy",async()=>{
  const {actions,get,navigate,ui}=await import("./store");
  navigate({panel:false,selected:null});ui.send({type:"toast.dismiss"});
  const key=actions.create("Toasted")!;
  expect(get().panel).toBe(false);expect(get().selected).toBe(key);expect(get().toast).toEqual({text:`Created ${key}`,key});
  const copy=actions.duplicate(key)!;
  expect(get().panel).toBe(true);expect(get().selected).toBe(copy);
});
