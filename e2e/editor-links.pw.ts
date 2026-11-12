import { expect, test, fixture, shownIssue } from "./app";

const editor = `document.querySelector('#description')`;
const linkTo = (href: string) => `#description a[href="${href}"]`;
const reference = "https://example.test/reference";
const mac = `navigator.platform.includes('Mac')`;
const opened = async (page: { eval: <T>(e: string) => Promise<T> }) =>
  page.eval<string | null>(`(()=>{const u=window.__opened??null;window.__opened=null;return u})()`);

test("BJ-179: a click on a link in the focused description selects it and shows Linear's link editor", async ({ open }) => {
  const page = await open("?issue=TEST-2&view=page");
  await page.eval(`window.open=(url)=>{window.__opened=url;return null}`);
  await page.click("#description h2");
  await page.waitFor(`!!document.querySelector('${linkTo(reference)}')`);
  await page.click(linkTo(reference));
  expect(await opened(page)).toBeNull();
  expect(await page.eval(`getSelection().toString()`)).toBe("Formatted fixture");
  await page.waitFor(`!!document.querySelector('[aria-label="Link URL"]')`);
  expect(
    await page.eval(`(()=>{const i=document.querySelector('[aria-label="Link URL"]');return [i.placeholder,i.value]})()`),
  ).toEqual(["Enter link URL", reference]);
  expect(await page.eval(`[...document.querySelectorAll('[aria-label="Link"] button')].map(b=>b.ariaLabel)`)).toEqual([
    "Open in new window",
    "Remove link",
  ]);
  // The editor keeps focus, and the link editor stands in for the formatting toolbar.
  expect(await page.eval(`document.querySelector('#description').contains(document.activeElement)`)).toBe(true);
  expect(await page.eval(`!!document.querySelector('[aria-label="Description formatting"]')`)).toBe(false);

  await test.step("Mod held marks links clickable; Mod-click and middle-click open the link", async () => {
    const key = (type: string) =>
      `${editor}.dispatchEvent(new KeyboardEvent('${type}',{key:${mac}?'Meta':'Control',bubbles:true}))`;
    await page.eval(key("keydown"));
    expect(await page.eval(`${editor}.classList.contains('link-active')`)).toBe(true);
    await page.eval(key("keyup"));
    expect(await page.eval(`${editor}.classList.contains('link-active')`)).toBe(false);
    await page.eval(
      `document.querySelector('${linkTo(reference)}').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0,detail:1,metaKey:${mac},ctrlKey:!${mac}}))`,
    );
    expect(await opened(page)).toBe(reference);
    await page.eval(
      `document.querySelector('${linkTo(reference)}').dispatchEvent(new MouseEvent('auxclick',{bubbles:true,cancelable:true,button:1}))`,
    );
    expect(await opened(page)).toBe(reference);
  });

  await test.step("⌘K edits the link: a new address applies on ↵ and the caret goes back after it", async () => {
    await page.key("k", "meta");
    await page.waitFor(`document.activeElement?.ariaLabel==='Link URL'`);
    await page.key("a", "meta");
    await page.type("example.test/next");
    await page.key("Enter");
    await page.waitFor(`!!document.querySelector('${linkTo("https://example.test/next")}')`);
    expect(await page.eval(`document.querySelector('#description').contains(document.activeElement)`)).toBe(true);
    expect(await page.eval(`getSelection().isCollapsed`)).toBe(true);
    expect(await page.eval(`!!document.querySelector('[aria-label="Link URL"]')`)).toBe(false);
  });

  await test.step("Remove link unlinks it", async () => {
    await page.click(linkTo("https://example.test/next"));
    await page.click('[aria-label="Remove link"]');
    await page.waitFor(`!document.querySelector('${linkTo("https://example.test/next")}')`);
    expect(await page.eval<string>(`${editor}.textContent`)).toContain("Formatted fixture");
  });
});

test("an issue link in a rendered comment opens the issue here", async ({ open }) => {
  const card = `{type:'inlineCard',attrs:{url:'https://example.atlassian.net/browse/TEST-4'}}`;
  const setup = `const read=fetch;window.fetch=async(...args)=>{const response=await read(...args);if(new URL(String(args[0]),location.href).pathname!=='/api/issues/TEST-2')return response;const issue=await response.json();issue.fields.comment={total:1,comments:[{id:'c-link',author:issue.fields.reporter,created:'2026-11-06T10:00:00Z',body:{type:'doc',version:1,content:[{type:'paragraph',content:[{type:'text',text:'see '},${card}]}]}}]};return Response.json(issue)}`;
  const page = await open("?issue=TEST-2&view=page", { setup });
  const link = `.rich-doc a[href="https://example.atlassian.net/browse/TEST-4"]:not(#description *)`;
  await page.waitFor(`!!document.querySelector(${JSON.stringify(link)})`);
  await page.eval(`window.open=()=>{window.__opened=true}`);
  await page.click(link);
  await page.waitFor(`${shownIssue}==='TEST-4'`);
  expect(await page.eval(`!!window.__opened`)).toBe(false);
});

test("BJ-16: Jira smart links of every kind show as Linear's mention chips, and an edit writes each back as the same node", async ({
  open,
}) => {
  await fixture.reset({ smartLinks: true, writable: true });
  const page = await open("?issue=TEST-2&view=page");
  const chips = (scope: string) =>
    `[...document.querySelectorAll(${JSON.stringify(`${scope} a.smart-link`)})].map(a=>[a.dataset.smartLink,a.textContent.replace(/[\\u2060\\u00a0]/g,'').trim()])`;
  const expected = [
    ["issue", "TEST-3 Browser fixture 3"], // on the board: the mirror's title and status
    ["issue", "OPS-7 Rotate the staging keys"], // this site, off the board: the server's one read
    ["issue", "PX-3"], // another site: the key, as Linear's fallback
    ["confluence", "Release checklist (v2)"], // the page's own title, read by the server
    ["external", "acme/widgets#42"],
    ["external", "Google Sheet"],
    ["external", "Slack message"],
    ["external", "Checkout flow"],
    ["external", "Loom video"],
    ["external", "docs.example.com/guides/getting-started"],
    ["external", "acme/widgets#7"], // blockCard
    ["external", "example.com/handbook"], // an embedCard Linear can't frame
  ];
  await test.step("the editor shows each kind with Linear's chip; icons come from this server only", async () => {
    await page.waitFor(`document.getElementById('description')?.classList.contains('ProseMirror') && JSON.stringify(${chips("#description")})===${JSON.stringify(JSON.stringify(expected))}`, 8000);
    expect(
      await page.eval(
        `[...document.querySelectorAll('#description a.smart-link[data-smart-link=issue]')].map(a=>!!a.querySelector('.smart-link-image svg circle'))`,
      ),
    ).toEqual([true, true, true]);
    await page.waitFor(
      `[...document.querySelectorAll('#description a.smart-link[href^="https://github.com"] img')].every(i=>i.complete&&i.naturalWidth>0)`,
    );
    // A site with no icon falls back to the link icon, the same size.
    expect(await page.eval(`!!document.querySelector('#description a.smart-link[href^="https://www.loom.com"] .smart-link-image svg')`)).toBe(true);
    expect(
      await page.eval(`performance.getEntriesByType('resource').map(e=>e.name).filter(n=>!n.startsWith(location.origin))`),
    ).toEqual([]);
    // The block card keeps its own line.
    expect(await page.eval(`document.querySelector('#description p.smart-link-block a')?.textContent.includes('acme/widgets#7')`)).toBe(true);
  });
  await test.step("BJ-199: an issue mention opens the shared issue hover card", async () => {
    await page.hover('#description a.smart-link[href$="/browse/TEST-3"]');
    await page.waitFor(`!!document.querySelector('[data-issue-hover="TEST-3"]')`);
    expect(await page.eval(`document.querySelector('[data-issue-hover="TEST-3"]').textContent`)).toContain("TEST-3");
    await page.page.mouse.move(0, 0);
  });
  await test.step("a comment's smart link is the same chip", async () => {
    await page.waitFor(`JSON.stringify(${chips(".rich-doc:not(#description *):not(#description)")})==='[["external","acme/widgets#42"]]'`);
  });
  await test.step("editing the description writes every smart link back as the node and URL Jira sent", async () => {
    await page.click("#description h2");
    await page.key("End");
    await page.type(" edited");
    await page.click("#summary");
    const cards = async () => {
      const writes = (await fixture.log()).writes.filter((w: { key: string }) => w.key === "TEST-2");
      const doc = writes.flatMap((w: any) => w.ops).reverse().find((op: any) => op.op === "fields" && op.fields.description)?.fields.description;
      if (!doc) return null;
      const found: unknown[] = [];
      const walk = (n: any) => {
        if (n.type.endsWith("Card")) found.push([n.type, n.attrs]);
        (n.content ?? []).forEach(walk);
      };
      walk(doc);
      return JSON.stringify(doc).includes("Rich fixture heading edited") ? found : null;
    };
    await expect.poll(cards, { timeout: 8000 }).toEqual([
      ["inlineCard", { url: "https://example.atlassian.net/browse/TEST-3" }],
      ["inlineCard", { url: "https://example.atlassian.net/browse/OPS-7?focusedCommentId=10" }],
      ["inlineCard", { url: "https://partner.atlassian.net/browse/PX-3" }],
      ["inlineCard", { url: "https://example.atlassian.net/wiki/spaces/ENG/pages/123456/Release+checklist" }],
      ["inlineCard", { url: "https://github.com/acme/widgets/pull/42" }],
      ["inlineCard", { url: "https://docs.google.com/spreadsheets/d/abc123/edit#gid=0" }],
      ["inlineCard", { url: "https://acme.slack.com/archives/C0123/p1700000000000100" }],
      ["inlineCard", { url: "https://www.figma.com/design/AbC123/Checkout-flow?node-id=1-2" }],
      ["inlineCard", { url: "https://www.loom.com/share/0123abcd" }],
      ["inlineCard", { url: "https://docs.example.com/guides/getting-started" }],
      ["blockCard", { url: "https://github.com/acme/widgets/issues/7" }],
      ["embedCard", { url: "https://example.com/handbook", layout: "center" }],
    ]);
  });
  await test.step("an issue on the board opens here; another opens Jira's page", async () => {
    await page.eval(`window.open=(url)=>{window.__opened=url;return null}`);
    await page.click('#description a.smart-link[href$="/browse/OPS-7?focusedCommentId=10"]');
    expect(await opened(page)).toBe("https://example.atlassian.net/browse/OPS-7?focusedCommentId=10");
    await page.click('#description a.smart-link[href$="/browse/TEST-3"]');
    await page.waitFor(`${shownIssue}==='TEST-3'`);
  });
});
