import {expect,test} from "bun:test";
import {adfToMarkdown,issueCopy} from "./issue-copy";
import type {Issue} from "./store";
test("clipboard projections retain rich formatting, tables and exact IDs/URLs",()=>{
  const issue:Issue={key:"TEST-1",board:1,summary:"Fix [menu]",status:"todo",assignee:null,labels:["ui"],updated:"",resolved:null,comments:0};
  expect(issueCopy("ID",issue,undefined,"https://example.test/browse/TEST-1","Todo")).toBe("TEST-1");
  expect(issueCopy("URL",issue,undefined,"https://example.test/browse/TEST-1","Todo")).toBe("https://example.test/browse/TEST-1");
  expect(issueCopy("title as link",issue,undefined,"https://example.test/a(b)","Todo")).toBe("[TEST-1 Fix \\[menu\\]](https://example.test/a%28b%29)");
  const paragraph={type:"paragraph",content:[{type:"text",text:"A|B"}]};
  const table={type:"table",content:[{type:"tableRow",content:[{type:"tableHeader",content:[paragraph]}]}]};
  const bold={type:"paragraph",content:[{type:"text",text:"Rich",marks:[{type:"strong"}]}]};
  expect(adfToMarkdown({type:"doc",content:[bold,table]})).toBe("**Rich**\n\n| A\\|B |\n| --- |");
});
