import { describe, expect, test } from "bun:test";
import { buckets, defaultPreferences, listRows, matchesFilters, matchesRule, parsePreferences, selectIssues, statusDuration, updateFilter, type FilterGroup, type Rule } from "./view-model";
import type { Board, Issue } from "./store";

const board: Board = {id:1,name:"Board",columns:[{name:"Todo",statuses:[{id:"todo",name:"Todo",category:"new"}]},{name:"Doing",statuses:[{id:"doing",name:"In Progress",category:"indeterminate"}]},{name:"Done",statuses:[{id:"done",name:"Done",category:"done"}]}]};
const now = new Date("2026-11-06T12:00:00Z").getTime();
const issue = (key:string, patch:Partial<Issue>={}):Issue => ({key,board:1,summary:key,status:"todo",assignee:null,labels:[],comments:0,updated:"2026-11-06T10:00:00Z",resolved:null,...patch});
const all = [
  issue("A-1",{assignee:{id:"me",name:"Me"},priority:"High",labels:["bug","ui"],rank:"c",created:"2026-10-01T00:00:00Z"}),
  issue("A-2",{assignee:{id:"other",name:"Other"},priority:"Low",labels:["ui"],rank:"a",parent:"A-1",status:"doing",due:"2026-11-07"}),
  issue("A-3",{status:"done",resolved:"2026-11-05T12:00:00Z",rank:"b"}),
  issue("A-4",{status:"done",resolved:"2026-10-01T12:00:00Z"}),
];
const rule = (field:Rule["field"],values:string[],op:Rule["op"]="is"):Rule => ({id:field,field,op,values});
describe("view selection",()=>{
  test("preserves board and recent-completion scope before applying mine and search",()=>{
    const prefs=defaultPreferences();
    expect(selectIssues([...all,issue("B-1",{board:2})],board,prefs,false,"","me",now).map(i=>i.key)).toEqual(["A-2","A-3","A-1"]);
    expect(selectIssues(all,board,prefs,true,"A-1","me",now).map(i=>i.key)).toEqual(["A-1"]);
    prefs.display.subIssues=false;
    expect(selectIssues(all,board,prefs,false,"","me",now).some(i=>i.key==="A-2")).toBe(false);
  });
  test("combines multi-value OR within a property and nested AND/OR across properties",()=>{
    const group:FilterGroup={id:"root",join:"and",children:[rule("labels",["bug","ui"]),{id:"or",join:"or",children:[rule("assignee",["$me"]),rule("priority",["Low"])]}]};
    expect(all.filter(i=>matchesFilters(i,group,all,"me",now)).map(i=>i.key)).toEqual(["A-1","A-2"]);
    const next=updateFilter(group,"or",{join:"and"});
    expect(all.some(i=>matchesFilters(i,next,all,"me",now))).toBe(false);
    expect(group.children).toHaveLength(2);
    expect(updateFilter(group,"labels",null).children).toHaveLength(1);
  });
  test("supports missing values, exclusions, content, and parent/child relations",()=>{
    expect(matchesRule(all[2]!,rule("assignee",["$none"]),all,"me",now)).toBe(true);
    expect(matchesRule(all[0]!,rule("labels",["bug"],"isNot"),all,"me",now)).toBe(false);
    expect(matchesRule(all[0]!,rule("content",["a-1"],"contains"),all,"me",now)).toBe(true);
    expect(matchesRule(all[0]!,rule("relations",["parent"]),all,"me",now)).toBe(true);
    expect(matchesRule(all[1]!,rule("relations",["child"]),all,"me",now)).toBe(true);
  });
  test("handles relative dates, missing dates, and invalid numeric ranges",()=>{
    expect(matchesRule(all[1]!,rule("due",["7"],"next"),all,"me",now)).toBe(true);
    expect(matchesRule(all[2]!,rule("resolved",["7"],"within"),all,"me",now)).toBe(true);
    expect(matchesRule(all[3]!,rule("resolved",["7"],"within"),all,"me",now)).toBe(false);
    expect(matchesRule(all[0]!,rule("due",[],"empty"),all,"me",now)).toBe(true);
    expect(matchesRule(all[1]!,rule("due",["oops"],"next"),all,"me",now)).toBe(false);
  });
  test("groups labels in every matching group and retains empty workflow columns",()=>{
    const groups=buckets([all[0]!],"label",board,all);
    expect(groups.find(g=>g.id==="bug")?.issues.map(i=>i.key)).toEqual(["A-1"]);
    expect(groups.find(g=>g.id==="ui")?.issues.map(i=>i.key)).toEqual(["A-1"]);
    expect(buckets([],"status",board).map(g=>g.name)).toEqual(["Todo","Doing","Done"]);
    expect(buckets([],"status",board,[],true)[0]?.name).toBe("Done");
  });
  test("orders priority, reverses direction, and keeps undated issues last",()=>{
    const p=defaultPreferences();p.display.ordering="priority";
    expect(selectIssues(all,board,p,false,"","me",now)[0]?.key).toBe("A-1");
    p.display.descending=true;
    expect(selectIssues(all,board,p,false,"","me",now).at(-1)?.key).toBe("A-1");
    p.display.ordering="due";
    expect(selectIssues(all,board,p,false,"","me",now)[0]?.key).toBe("A-2");
  });
  test("saved preferences round-trip and malformed settings fall back without crashing",()=>{
    const p=defaultPreferences();p.display.layout="list";p.display.properties=[];p.filters.children=[rule("assignee",["$me"])];
    expect(parsePreferences(JSON.parse(JSON.stringify(p)))).toEqual(p);
    const invalid=parsePreferences({display:{layout:"bad",columns:"bad",subIssues:false},filters:{children:[null,{field:"token",values:[]}]}});
    expect(invalid.display.layout).toBe("board");expect(invalid.display.subIssues).toBe(false);expect(invalid.filters.children).toEqual([]);
  });
  test("unfinished OR branches do not override completed filters",()=>{
    const group:FilterGroup={id:"root",join:"or",children:[rule("assignee",["$me"]),rule("priority",[]),{id:"empty",join:"and",children:[]}]};
    expect(all.filter(i=>matchesFilters(i,group,all,"me",now)).map(i=>i.key)).toEqual(["A-1"]);
  });
  test("list navigation follows nested display order and handles cycles once",()=>{
    expect(listRows([all[1]!,all[0]!],all,"matching").map(r=>[r.issue.key,r.depth])).toEqual([["A-1",0],["A-2",1]]);
    expect(listRows([all[0]!],all,"all").map(r=>r.issue.key)).toEqual(["A-1","A-2"]);
    const cycle=[issue("C-1",{parent:"C-2"}),issue("C-2",{parent:"C-1"})];
    expect(listRows(cycle,cycle,"matching")).toHaveLength(2);
  });
  test("filters watcher lists only when complete and supports milestone and numeric status duration",()=>{
    const item=issue("A-5",{watchers:[{id:"me",name:"Me"}],watchersComplete:true,milestones:[{id:"release",name:"Release"}],prCount:0,statusSince:"2026-10-30T12:00:00Z"});
    expect(matchesRule(item,rule("watchers",["$me"]),all,"me",now)).toBe(true);
    expect(matchesRule({...item,watchersComplete:false},rule("watchers",["$none"]),all,"me",now)).toBe(false);
    expect(matchesRule({...item,watchersComplete:false},rule("watchers",["other"],"isNot"),all,"me",now)).toBe(false);
    expect(matchesRule(item,rule("milestone",["release"]),all,"me",now)).toBe(true);
    expect(matchesRule(item,rule("statusAge",["6.5"],"gt"),all,"me",now)).toBe(true);
    expect(matchesRule(item,rule("pullRequests",["0"]),all,"me",now)).toBe(true);
    expect(matchesRule({...item,prCount:undefined},rule("pullRequests",["0"]),all,"me",now)).toBe(false);
  });
  test("persists enriched properties and formats status duration without negative ages",()=>{
    const p=defaultPreferences();
    p.display.properties=["milestone","statusAge","pullRequests"];
    p.display.ordering="estimate";
    p.filters.children=[rule("watchers",["$me"]),rule("statusAge",["7"],"gt")];
    expect(parsePreferences(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(statusDuration("2026-11-06T13:00:00Z",now)).toBe("<1m");
    expect(statusDuration("2026-11-06T11:00:00Z",now)).toBe("1h");
    expect(statusDuration("2026-11-04T12:00:00Z",now)).toBe("2d");
  });
});
