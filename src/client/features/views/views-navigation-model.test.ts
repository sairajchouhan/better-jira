import { type Issue } from "@/shared/issue-model";
import { expect, test } from "bun:test";
import { resultFeedback, viewSummaries } from "./views-navigation-model";

test("feedback distinguishes saved definition and temporary overlay, including partially hidden results", () => {
  expect(resultFeedback(0,4,"view",true)).toEqual({kind:"filtered",text:"No issues matching the filters",hidden:4});
  expect(resultFeedback(0,0,"view",false)).toEqual({kind:"saved",text:"No matching issues"});
  expect(resultFeedback(0,0,"view",true)).toEqual({kind:"saved",text:"No matching issues"});
  expect(resultFeedback(0,3,"tab",true)).toEqual({kind:"filtered",text:"No issues matching the filters",hidden:3});
  expect(resultFeedback(2,5,"view",true)).toEqual({kind:"partial",text:"3 issues hidden by filters",hidden:3});
  expect(resultFeedback(4,4,"view",false)).toBeNull();
  expect(resultFeedback(4,4,"person",false)).toBeNull();
});
// BJ-336: an empty page draws its own empty state, never blank columns. Linear: a board tab with no issue and no filter
// shows its ViewEmptyState (HiddenIndicator's zeroStateFallback); with a filter, "No issues matching the filters" and no
// hidden row. My issues shows MyIssuesEmptyPage whenever the tab holds no issue, filtered or not (MyIssuesViewPage `pe`).
test("a page with no issue gets its empty state: a board tab unless filtered, a personal tab always", () => {
  expect(resultFeedback(0,0,"tab",false)).toEqual({kind:"empty"});
  expect(resultFeedback(0,0,"tab",true)).toEqual({kind:"filtered",text:"No issues matching the filters",hidden:0});
  expect(resultFeedback(0,0,"person",false)).toEqual({kind:"empty"});
  expect(resultFeedback(0,0,"person",true)).toEqual({kind:"empty"});
  expect(resultFeedback(0,2,"person",true)).toEqual({kind:"filtered",text:"No issues matching the filters",hidden:2});
});
test("details summarize result assignees and labels with counts", () => {
  const issues = [{assignee:{name:"Raj"},labels:["bug","bug"]},{assignee:null,labels:["bug","ui"]}] as Issue[];
  expect(viewSummaries(issues)).toEqual({assignees:[["Raj",1],["Unassigned",1]],labels:[["bug",2],["ui",1]]});
});
