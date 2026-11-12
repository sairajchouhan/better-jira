import { expect, fixture, sleep, test } from "./app";

/** The fullest column, which is tall enough to scroll. */
const column = `[...document.querySelectorAll('[data-scroll-restoration-id^="board-1-column-"]')].sort((a,b)=>b.scrollHeight-a.scrollHeight)[0]`;
const body = `document.querySelector('[data-scroll-restoration-id="issue-body"]')`;
const where = `location.pathname+location.search`;

test("router: Back restores the issue body and the board's scroll; a new issue and j/k start at the top", async ({ open }) => {
  await fixture.reset({ bulk: 60 });
  const app = await open("/team/1/all", { height: 520 });
  const columnTop = await app.eval<number>(`(${column}.scrollTop=600,${column}.scrollTop)`);
  expect(columnTop).toBeGreaterThan(300);
  await sleep(150); // the scroll event is what the router snapshots
  // Enter on a card in view opens its page.
  const key = await app.eval<string>(
    `[...${column}.querySelectorAll('[data-key]')].find(c=>{const r=c.getBoundingClientRect(),o=${column}.getBoundingClientRect();return r.top>=o.top&&r.bottom<=o.bottom}).dataset.key`,
  );
  await app.eval(`document.querySelector('[data-key="${key}"]').focus()`);
  await app.key("Enter");
  await app.waitFor(`location.pathname==='/issue/${key}'&&!!${body}`);
  const bodyTop = await app.eval<number>(`(${body}.scrollTop=200,${body}.scrollTop)`);
  expect(bodyTop).toBeGreaterThan(50);
  await sleep(150);
  await app.keys("gi");
  await app.waitFor(`location.pathname==='/inbox'`);
  await app.page.goBack();
  await app.waitFor(`location.pathname==='/issue/${key}'&&${body}?.scrollTop===${bodyTop}`);
  await app.page.goBack();
  await app.waitFor(`${where}==='/team/1/all'&&${column}?.scrollTop===${columnTop}`);
  await app.page.goForward();
  await app.waitFor(`location.pathname==='/issue/${key}'&&${body}?.scrollTop===${bodyTop}`);
  // The next issue is a new page: it opens at its top, not where the last one was scrolled.
  await app.key("j");
  await app.waitFor(`location.pathname!=='/issue/${key}'&&location.pathname.startsWith('/issue/')`);
  await sleep(100);
  expect(await app.eval(`${body}.scrollTop`)).toBe(0);
});

test("router: resting on a card loads its issue before the click", async ({ open }) => {
  await fixture.reset({ bulk: 60 });
  const app = await open("/team/1/all");
  const loaded = async (key: string) =>
    (await fixture.log()).requests.some((r) => r.method === "GET" && r.path === `/api/issues/${key}`);
  // BULK-7 is a To do card, away from any selection the board prefetches around.
  expect(await loaded("BULK-7")).toBe(false);
  await app.hover('[data-key="BULK-7"]');
  await app.waitFor(`new Promise(r=>setTimeout(()=>r(true),300))`);
  await expect.poll(() => loaded("BULK-7")).toBe(true);
  await app.click('[data-key="BULK-7"]');
  await app.waitFor(`${where}==='/team/1/all?issue=BULK-7'`);
});

test("router: unknown issues and addresses show not found", async ({ open }) => {
  const app = await open("/issue/NOPE-1");
  await app.waitFor(`document.body.textContent.includes('Issue NOPE-1 not found')`);
  await app.goto("/team/1/all?issue=NOPE-2");
  await app.waitFor(`document.body.textContent.includes('Issue NOPE-2 not found')`);
  await app.goto("/somewhere/else");
  await app.waitFor(`document.body.textContent.includes('Page not found')`);
  await app.click('a[href="/"]');
  await app.waitFor(`${where}==='/team/1/all'&&!document.body.textContent.includes('Page not found')`);
});

test("router: old addresses land on the paths that replaced them", async ({ open }) => {
  const app = await open("/team/1/all");
  const cases: [string, string][] = [
    ["/?board=1&issue=TEST-2&view=page", "/issue/TEST-2"],
    ["/?issue=TEST-2&view=side", "/team/1/all?issue=TEST-2"],
    ["/?board=1", "/team/1/all"],
    ["/?board=1&mine=1", "/my-issues"],
    ["/?board=1&inbox=1", "/inbox"],
    ["/views?board=1", "/team/1/all"],
    ["/team/1/views", "/team/1/all"],
  ];
  for (const [from, to] of cases) {
    await app.page.goto(new URL(from, fixture.url).href);
    await app.waitFor(`${where}===${JSON.stringify(to)}`);
  }
});
