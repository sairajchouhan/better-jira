import { expect, test } from "bun:test";
import { directoryViews, resultFeedback, viewSummaries } from "./views-navigation-model";
import type { SavedView } from "./saved-view-model";
import type { Issue } from "./store";
test("directory is board scoped, excludes tabs, and sorts without mutating", () => {
  const views = [{id:"1",board:1,kind:"custom",name:"Z"},{id:"2",board:1,kind:"tab",name:"A"},{id:"3",board:2,kind:"custom",name:"B"},{id:"4",board:1,kind:"custom",name:"C"}] as SavedView[];
  expect(directoryViews(views,1).map(v=>v.name)).toEqual(["C","Z"]);
  expect(directoryViews(views,1,true).map(v=>v.name)).toEqual(["Z","C"]);
  expect(directoryViews(views,1,true,"owner").map(v=>v.name)).toEqual(["C","Z"]);
  expect(views[0]!.name).toBe("Z");
});
test("feedback distinguishes saved definition and temporary overlay, including partially hidden results", () => {
  expect(resultFeedback(0,4,true,true)).toEqual({text:"No issues matching the filters",saved:false,hidden:4});
  expect(resultFeedback(0,0,true,false)).toEqual({text:"No matching issues",saved:true,hidden:0});
  expect(resultFeedback(0,0,true,true)).toEqual({text:"No matching issues",saved:true,hidden:0});
  expect(resultFeedback(0,3,false,true)).toEqual({text:"No issues matching the filters",saved:false,hidden:3});
  expect(resultFeedback(2,5,true,true)?.text).toBe("3 issues hidden by filters");
  expect(resultFeedback(4,4,true,false)).toBeNull();
});
test("details summarize result assignees and labels with counts", () => {
  const issues = [{assignee:{name:"Raj"},labels:["bug","bug"]},{assignee:null,labels:["bug","ui"]}] as Issue[];
  expect(viewSummaries(issues)).toEqual({assignees:[["Raj",1],["Unassigned",1]],labels:[["bug",2],["ui",1]]});
});
