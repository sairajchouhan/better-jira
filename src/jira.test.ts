import { expect, test } from "bun:test";

test("Jira mutations fail before network access while the documented changelog read remains allowed",async()=>{
  const originalFetch=globalThis.fetch;
  const email=process.env.JIRA_EMAIL,token=process.env.JIRA_TOKEN;
  let calls=0;
  try {
    process.env.JIRA_EMAIL="test@example.invalid";process.env.JIRA_TOKEN="test-only";
    globalThis.fetch=Object.assign(async()=>{calls++;return Response.json({ok:true});},originalFetch);
    const {jira}=await import("./jira");
    for(const method of ["POST","PUT","DELETE","PATCH","post"])
      await expect(jira("/rest/api/3/issue/TEST-1",{method})).rejects.toThrow("Jira writes are disabled");
    expect(calls).toBe(0);
    await jira("/rest/api/3/issue/TEST-1");
    await jira("/rest/api/3/changelog/bulkfetch",{method:"POST"});
    expect(calls).toBe(2);
  }finally {
    globalThis.fetch=originalFetch;
    if(email===undefined)delete process.env.JIRA_EMAIL;else process.env.JIRA_EMAIL=email;
    if(token===undefined)delete process.env.JIRA_TOKEN;else process.env.JIRA_TOKEN=token;
  }
});
