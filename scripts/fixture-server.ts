/** Disposable browser-test data. No Jira client, credentials, or cache are imported. */
import index from "../src/index.html";
const rich={type:"doc",version:1,content:[
  {type:"heading",attrs:{level:2,localId:"heading-id"},content:[{type:"text",text:"Rich fixture heading"}]},
  {type:"paragraph",content:[{type:"text",text:"Formatted fixture",marks:[{type:"strong"},{type:"link",attrs:{href:"https://example.test/reference"}}]}]},
  {type:"bulletList",content:[{type:"listItem",content:[{type:"paragraph",content:[{type:"text",text:"A list item"}]}]}]},
  {type:"codeBlock",attrs:{language:"typescript"},content:[{type:"text",text:"const answer = 42;"}]},
  {type:"table",attrs:{layout:"wide"},content:[{type:"tableRow",content:[{type:"tableHeader",attrs:{colspan:1,rowspan:1},content:[{type:"paragraph",content:[{type:"text",text:"Header"}]}]},{type:"tableCell",attrs:{colspan:1,rowspan:1},content:[{type:"paragraph",content:[{type:"text",text:"Cell"}]}]}]}]},
  {type:"extension",attrs:{extensionType:"test",extensionKey:"preserve-me",parameters:{nested:[1,2,3]}}}
]};
const board={id:1,name:"Browser audit",columns:[{name:"Backlog",statuses:[{id:"backlog",name:"Backlog",category:"new"}]},{name:"Todo",statuses:[{id:"todo",name:"Todo",category:"new"}]},{name:"Doing",statuses:[{id:"doing",name:"Doing",category:"indeterminate"}]},{name:"Review",statuses:[{id:"review",name:"Review",category:"indeterminate"}]},{name:"Done",statuses:[{id:"done",name:"Done",category:"done"}]}]};
const user={id:"audit-me",name:"Audit user"};
const priorities=["Normal","Low","High","Urgent","Normal","Low"];
const issues=Array.from({length:6},(_,i)=>({key:`TEST-${i+1}`,board:1,summary:i===0?"Rich browser fixture":`Browser fixture ${i+1}`,status:i===2?"doing":"todo",rank:`0|i0000${i}:`,type:"Task",priority:priorities[i],assignee:i===1?{id:"alex",name:"Alex"}:null,labels:[i===0?"ui":"test"],comments:0,updated:"2026-11-06T10:00:00Z",created:"2026-11-06T10:00:00Z",resolved:null,project:{key:"TEST",name:"Audit"}}));
let clientFailures=0,detailFailures=0;const requests:{method:string;path:string;status:number}[]=[];
async function handle(req:Request){
  const url=new URL(req.url),path=url.pathname;
  if(path==="/__fixture"&&req.method==="POST"){const settings=await req.json();clientFailures=settings.clientFailures??0;detailFailures=settings.detailFailures??0;requests.length=0;return Response.json({ok:true});}
  if(path==="/__fixture"&&req.method==="GET")return Response.json({requests,rich});
  let status=200,body:unknown;
  if(req.method!=="GET"){status=405;body={error:"Fixture API is read-only"};}
  else if(path==="/api/client"){if(clientFailures-->0){status=503;body={error:"Test unavailable"};}else body={site:"https://example.atlassian.net",user};}
  else if(path==="/api/boards")body=[board];
  else if(path==="/api/issues")body=issues;
  else if(path==="/api/view-defaults")body={};
  else if(path==="/api/properties")body={entries:{},progress:{total:0,pending:0,completed:0,errors:0}};
  else if(path.startsWith("/api/issues/")){if(detailFailures-->0){status=503;body={error:"Test unavailable"};}else {const key=decodeURIComponent(path.split("/").at(-1)!);body={key,fields:{description:rich,reporter:{accountId:user.id,displayName:user.name},created:"2026-11-06T10:00:00Z",comment:{total:0,comments:[]}}};}}
  else {status=404;body={error:"Unknown fixture route"};}
  requests.push({method:req.method,path,status});return Response.json(body,{status});
}
const server=Bun.serve({hostname:"127.0.0.1",port:Number(process.env.FIXTURE_PORT??3001),routes:{"/*":index,"/api/*":handle,"/__fixture":handle}});
console.log(`Disposable browser fixture on ${server.url}`);
