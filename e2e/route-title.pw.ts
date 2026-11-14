import { expect, test } from "./app";

/** The browser tab's title per route, as Linear's router sets `document.title` (RouteInfoResolvers), and the
 *  screen-reader line it says after each navigation (`announceNavigation`). */
const title = `document.title`;
const said = `(document.querySelector('[data-route-announcer]')?.textContent ?? null)`;
const badge = `(document.querySelector('[data-inbox-badge]')?.textContent ?? '')`;

test("route titles: board, peek, issue page and its title edit, inbox count, My issues, Not found, Back", async ({ open }) => {
  const app = await open("/board/1/all");
  await test.step("a board's tab is `${team} › All issues`; the first page announces nothing", async () => {
    await app.waitFor(`${title}==="Browser audit › All issues"`);
    expect(await app.eval(said)).toBe("");
    expect(await app.eval(`document.querySelector('[data-route-announcer]').getAttribute('aria-live')`)).toBe("polite");
  });
  await test.step("an issue open beside the board keeps the board's title (Linear's peek doesn't navigate)", async () => {
    await app.click('[data-key="TEST-1"]');
    await app.waitFor(`new URLSearchParams(location.search).get('issue')==='TEST-1'`);
    expect(await app.eval(title)).toBe("Browser audit › All issues");
    await app.key("Escape");
    await app.waitFor(`!new URLSearchParams(location.search).has('issue')`);
  });
  await test.step("an issue page is `KEY Title`, led by the board tab it opened over, and is announced", async () => {
    await app.eval(`document.querySelector('[data-key="TEST-1"]').focus()`);
    await app.key("Enter");
    await app.waitFor(`location.pathname==='/issue/TEST-1'&&!!document.getElementById('summary')`);
    await app.waitFor(`${title}==="All issues › TEST-1 Rich browser fixture"`);
    await app.waitFor(`${said}==="Navigated to All issues › TEST-1 Rich browser fixture"`);
  });
  await test.step("editing the title retitles the tab without a new announcement", async () => {
    await app.click("#summary");
    await app.type(" edited");
    await app.key("Enter");
    await app.waitFor(`${title}==="All issues › TEST-1 Rich browser fixture edited"`);
    expect(await app.eval(said)).toBe("Navigated to All issues › TEST-1 Rich browser fixture");
  });
  await test.step("the Inbox shows the badge's unread count", async () => {
    await app.keys("gi");
    await app.waitFor(`location.pathname==='/inbox'`);
    await app.waitFor(`${badge}!==''&&${title}===\`Inbox (\${${badge}})\``);
    await app.waitFor(`${said}==="Navigated to "+document.title`);
  });
  await test.step("Back returns the issue page's title", async () => {
    await app.page.goBack();
    await app.waitFor(`location.pathname==='/issue/TEST-1'`);
    await app.waitFor(`${title}==="All issues › TEST-1 Rich browser fixture edited"`);
  });
  await test.step("My issues names its tab; an unknown address is Not found", async () => {
    await app.keys("gm");
    await app.waitFor(`location.pathname==='/my-issues'`);
    await app.waitFor(`${title}==="My issues › Assigned"`);
    await app.goto("/issue/NOPE-1");
    await app.waitFor(`document.body.textContent.includes('Issue NOPE-1 not found')`);
    expect(await app.eval(title)).toBe("Not found");
    await app.goto("/somewhere/else");
    await app.waitFor(`${title}==="Not found"`);
  });
});
