import { createInterface } from "node:readline/promises";
import { chmod } from "node:fs/promises";
import { boardIDs, configuration, siteURL, type LocalSettings } from "../src/config";

const settingsPath=".better-jira.local.json";
const local:LocalSettings=await Bun.file(settingsPath).json().catch(()=>({}));
if(process.argv.includes("--help")) {
  console.log("bun run setup          Configure your Jira site, credentials, and boards\nbun run setup --check  Validate existing configuration and read-only Jira access\n\nEnvironment: JIRA_URL, JIRA_EMAIL, JIRA_TOKEN, JIRA_BOARDS, JIRA_CACHE, PORT.\nSite and boards go in .better-jira.local.json; credentials go in .env. Both are ignored.");
  process.exit(0);
}
const checking=process.argv.includes("--check");
async function prompt(label:string,existing="") {
  const terminal=createInterface({input:process.stdin,output:process.stdout});
  try {const answer=(await terminal.question(`${label}${existing?` [${existing}]`:""}: `)).trim();return answer||existing;}finally{terminal.close();}
}
async function secret():Promise<string> {
  if(!process.stdin.isTTY)throw new Error("Interactive setup needs a terminal. Set JIRA_TOKEN in .env for noninteractive setup.");
  process.stdout.write(`Jira API token${process.env.JIRA_TOKEN?" [Enter keeps the saved token]":""}: `);
  process.stdin.setRawMode(true);process.stdin.resume();
  return new Promise((resolve,reject)=>{
    let value="";
    const finish=(error?:Error)=>{process.stdin.off("data",read);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write("\n");error?reject(error):resolve(value||process.env.JIRA_TOKEN||"");};
    const read=(chunk:Buffer)=>{for(const char of chunk.toString()){if(char==="\u0003"){finish(new Error("Setup cancelled"));return;}if(char==="\r"||char==="\n"){finish();return;}if(char==="\u007f"||char==="\b")value=value.slice(0,-1);else if(char>=" ")value+=char;}};
    process.stdin.on("data",read);
  });
}
try {
  let site=process.env.JIRA_URL||local.site||"",email=process.env.JIRA_EMAIL||"",token=process.env.JIRA_TOKEN||"";
  if(!checking){site=siteURL(await prompt("Jira site, e.g. https://your-team.atlassian.net",site));email=await prompt("Jira account email",email);token=await secret();}
  const auth=btoa(`${email}:${token}`);
  const read=async(path:string)=>{
    const response=await fetch(`${site}${path}`,{headers:{Authorization:`Basic ${auth}`,Accept:"application/json"},signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error(`Jira returned ${response.status}. Check the site, token, and your account's access.`);
    return response.json();
  };
  // Validate syntax before sending credentials anywhere.
  configuration({JIRA_URL:site,JIRA_EMAIL:email,JIRA_TOKEN:token,JIRA_BOARDS:process.env.JIRA_BOARDS||local.boards?.join(",")||"1"},local);
  const profile=await read("/rest/api/3/myself");
  console.log(`Connected as ${profile.displayName}. Jira writes remain disabled.`);
  let boards=process.env.JIRA_BOARDS?boardIDs(process.env.JIRA_BOARDS):local.boards??[];
  if(!checking){
    console.log("\nBoards you can access:");
    let startAt=0;
    while(true){const page=await read(`/rest/agile/1.0/board?maxResults=50&startAt=${startAt}`);for(const board of page.values??[])console.log(`  ${board.id}  ${board.name}`);if(page.isLast||(page.values??[]).length<50)break;startAt+=50;}
    boards=boardIDs(await prompt("Board IDs, separated by commas",boards.join(",")));
  }
  const config=configuration({JIRA_URL:site,JIRA_EMAIL:email,JIRA_TOKEN:token,JIRA_BOARDS:boards.join(",")},local);
  for(const id of config.boards){const board=await read(`/rest/agile/1.0/board/${id}/configuration`);console.log(`Verified board ${id}: ${board.name}`);}
  if(!checking){
    const envFile=Bun.file(".env"),previous=await envFile.text().catch(()=>"");
    const retained=previous.split(/\r?\n/).filter(line=>!/^\s*(?:export\s+)?JIRA_(?:EMAIL|TOKEN|URL|BOARDS)\s*=/.test(line)).join("\n").trimEnd();
    await Bun.write(".env",`${retained}${retained?"\n":""}JIRA_EMAIL=${JSON.stringify(email)}\nJIRA_TOKEN=${JSON.stringify(token)}\n`);await chmod(".env",0o600);
    await Bun.write(settingsPath,JSON.stringify({...local,site,boards},null,2)+"\n");
    console.log("\nSetup saved. Run bun start, then open http://localhost:"+config.port+".");
  }else console.log("Configuration and read access verified.");
}catch(error){console.error(error instanceof Error?error.message:"Setup failed");process.exitCode=1;}
