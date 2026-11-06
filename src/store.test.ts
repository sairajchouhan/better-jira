import { expect, test } from "bun:test";
import type { Board } from "./store";

const storage=new Map<string,string>();
Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)}});
Object.defineProperty(globalThis,"requestAnimationFrame",{configurable:true,value:(callback:FrameRequestCallback)=>setTimeout(()=>callback(0),0)});

test("personal issue edits, comments, creation and deletion undo without losing issue details",async()=>{
  const {actions,get,set,undoEdit,redoEdit,ME}=await import("./store");
  const board:Board={id:1,name:"Personal",columns:[{name:"Todo",statuses:[{id:"todo",name:"Todo",category:"new"}]},{name:"Done",statuses:[{id:"done",name:"Done",category:"done"}]}]};
  set({boards:[board],board:1,issues:new Map(),full:new Map()});
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
  const key= [...get().issues.keys()][0]!;
  const full=new Map(get().full);full.delete(key);set({full});
  const original=globalThis.fetch;
  try {
    globalThis.fetch=Object.assign(async()=>new Response("unavailable",{status:503}),original);
    await loadFull(key);expect(get().fullErrors.get(key)).toBe("Could not load issue details");expect(get().full.has(key)).toBe(false);
    globalThis.fetch=Object.assign(async()=>Response.json({key,fields:{description:null,comment:{comments:[],total:0}}}),original);
    await loadFull(key);expect(get().full.has(key)).toBe(true);expect(get().fullErrors.get(key)).toBe("");
  }finally{globalThis.fetch=original;}
});

test("browser history restores issue selection without pushing another navigation",async()=>{
  const {get,set,load}=await import("./store");
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
    globalThis.fetch=Object.assign(async(input:string|URL|Request)=>Response.json(String(input)==="/api/boards"?boards:String(input)==="/api/issues"?issues:{entries:{},progress:{total:0,pending:0,completed:0,errors:0}}),originalFetch);
    await load();
    set({selected:first!.key,panel:true,view:"page"});set({selected:second!.key});
    expect(entries).toHaveLength(3);
    page.href=entries[--index]!;popstate!();
    expect(get().selected).toBe(first!.key);expect(get().panel).toBe(true);expect(get().view).toBe("page");expect(entries).toHaveLength(3);
    page.href=entries[++index]!;popstate!();expect(get().selected).toBe(second!.key);
    set({panel:false});expect(new URL(page.href).searchParams.has("issue")).toBe(false);
  }finally {
    globalThis.fetch=originalFetch;
    keys.forEach((key,i)=>{const descriptor=descriptors[i];if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);});
  }
});
