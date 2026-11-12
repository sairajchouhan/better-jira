import { expect, test } from "bun:test";
import { resultFeedback, viewSummaries } from "./views-navigation-model";
import type { Issue } from "@/client/state/store";
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
