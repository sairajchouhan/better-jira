import { expect,test } from "bun:test";
import { boardIDs,configuration,siteURL } from "./config";
const env={JIRA_URL:"https://example.atlassian.net/",JIRA_EMAIL:"person@example.invalid",JIRA_TOKEN:"test-only",JIRA_BOARDS:"12,34,12"};
test("setup validates site and board IDs and separates caches by account and site",()=>{
  const first=configuration(env);
  expect(first.site).toBe("https://example.atlassian.net");expect(first.boards).toEqual([12,34]);
  expect(configuration({...env,JIRA_EMAIL:"another@example.invalid"}).cachePath).not.toBe(first.cachePath);
  expect(configuration({...env,JIRA_URL:"https://other.atlassian.net"}).cachePath).not.toBe(first.cachePath);
  expect(configuration(env,{cachePath:"my-cache.db"}).cachePath).toBe("my-cache.db");
  const saved={site:"https://work.atlassian.net",boards:[9],port:3000,cachePath:"cache.db"};
  expect(()=>configuration({...env,JIRA_BOARDS:""},saved)).toThrow("JIRA_BOARDS");
  expect(configuration({...env,JIRA_BOARDS:"5"},saved).cachePath).not.toBe("cache.db");
  expect(configuration({...env,JIRA_URL:"https://work.atlassian.net",JIRA_BOARDS:""},saved)).toMatchObject({boards:[9],cachePath:"cache.db"});
  for(const url of ["http://example.com","https://user:password@example.com","https://example.com/path","https://example.com?token=x"])
    expect(()=>siteURL(url)).toThrow();
  for(const value of ["","1,","-1","1.5","NaN"])expect(()=>boardIDs(value)).toThrow();
  expect(()=>configuration({...env,PORT:"0"})).toThrow();
  expect(()=>configuration({...env,JIRA_TOKEN:""})).toThrow("bun run setup");
});
