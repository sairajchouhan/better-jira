import { expect, test, type App as Page } from "./app";

const input = `document.querySelector('input[aria-label="Jira board link or ID"]')`;
async function enter(p: Page, text: string) {
  // Replace the field's text the way React sees typing.
  await p.eval(
    `(()=>{const i=${input};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'');i.dispatchEvent(new Event('input',{bubbles:true}));i.focus()})()`,
  );
  await p.type(text);
  await p.key("Enter");
}

test("Add board: a board from another site is refused; a board link mirrors and opens without a reload", async ({
  open,
}) => {
  const p = await open();
  try {
    await p.eval(`window.__sameDocument = true`);
    await p.key("k", "meta");
    await p.waitFor(`!!document.querySelector('[cmdk-input]')`);
    await p.type("Add board");
    await p.waitFor(
      `document.querySelector('[cmdk-item][data-selected=true]')?.textContent?.includes('Add board')`,
    );
    await p.key("Enter");
    await p.waitFor(`!!${input}`);

    await enter(p, "https://other.atlassian.net/jira/software/projects/ADD/boards/2");
    await p.waitFor(
      `document.querySelector('[role=alert]')?.textContent?.includes('other.atlassian.net')`,
    );
    await enter(p, "https://example.atlassian.net/jira/software/projects/ADD/boards/9");
    await p.waitFor(
      `document.querySelector('[role=alert]')?.textContent?.includes("Board 9 doesn't exist")`,
    );

    await enter(p, "https://example.atlassian.net/jira/software/projects/ADD/boards/2");
    await p.waitFor(`!${input}`);
    await p.waitFor(`location.pathname.startsWith('/team/2/')`);
    await p.waitFor(`!!document.querySelector('[data-key="ADD-1"]')`);
    expect(
      await p.eval(
        `[...document.querySelectorAll('nav[aria-label="Main navigation"] button')].some(b=>b.textContent.includes('Second board'))`,
      ),
    ).toBe(true);
    expect(await p.eval(`window.__sameDocument`)).toBe(true);

    // Adding it again changes nothing and says so.
    await p.click('button[aria-label="Add board"]');
    await enter(p, "2");
    await p.waitFor(
      `document.querySelector('[data-toast]')?.textContent?.includes('already in your sidebar')`,
    );
    expect(
      await p.eval(
        `[...document.querySelectorAll('nav[aria-label="Main navigation"] button')].filter(b=>b.textContent.includes('Second board')).length`,
      ),
    ).toBe(1);

    // BJ-24: a board added in the app leaves the sidebar from its context menu; setup's board can't.
    const sidebarRow = (name: string) =>
      `[...document.querySelectorAll('nav[aria-label="Main navigation"] button')].find(b=>b.textContent.includes('${name}'))`;
    const rightClick = (name: string) =>
      p.eval(
        `(()=>{const n=${sidebarRow(name)},r=n.getBoundingClientRect();n.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.x+20,clientY:r.y+10}))})()`,
      );
    // CORE-15: every board has Linear's team menu; only a board added in the app can be removed.
    const options = `[...document.querySelectorAll('[role="dialog"][aria-label="Board options"] [cmdk-item]')].map(n=>n.dataset.value)`;
    await rightClick("Browser audit");
    await p.waitFor(`${options}.length > 0`);
    expect(await p.eval(options)).toEqual(["Favorite", "Copy URL", "Open in new tab"]);
    await p.key("Escape");
    await p.waitFor(`!document.querySelector('[role="dialog"][aria-label="Board options"]')`);
    await rightClick("Second board");
    await p.waitFor(`${options}.join() === "Favorite,Copy URL,Open in new tab,Remove from sidebar"`);
    await p.click('[role="dialog"][aria-label="Board options"] [cmdk-item][data-value="Remove from sidebar"]');
    await p.waitFor(`!${sidebarRow("Second board")}`);
    await p.waitFor(`location.pathname.startsWith('/team/1/')`);
    await p.waitFor(`!document.querySelector('[data-key="ADD-1"]')`);
  } finally {
    await p.close();
  }
});
