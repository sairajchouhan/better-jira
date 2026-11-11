import { expect, test } from "./app";

const chips = (editor: string) =>
  `[...document.querySelectorAll('${editor} .mention-chip')].map(n=>n.dataset.mentionId+':'+n.textContent).join('|')`;
const options = `[...document.querySelectorAll('[aria-label="Mention people"] [role=option]')].map(n=>(n.ariaSelected==='true'?'*':'')+n.lastElementChild.textContent).join('|')`;

test("@ mentions: the people picker in the description, the comment composer and a new sub-issue", async ({
  open,
}) => {
  const page = await open("?issue=TEST-2&view=page");

  await test.step("@ in the description opens the people picker; keys filter, choose and dismiss", async () => {
    await page.waitFor(`!!document.querySelector('#description p')`);
    await page.click("#description p");
    await page.key("End");
    await page.type(" @pri");
    expect(await page.waitFor<string>(options)).toBe("*Priya Raman");
    await page.key("Enter");
    expect(await page.waitFor<string>(chips("#description"))).toBe("priya:@Priya Raman");
    expect(await page.eval(`!!document.querySelector('[aria-label="Mention people"]')`)).toBe(
      false,
    );

    await page.type("@");
    await page.waitFor(`${options}.split('|').length === 3`);
    // Photos load through the same-origin avatar proxy; a broken avatar URL keeps the initial.
    const face = (name: string) =>
      `[...document.querySelectorAll('[aria-label="Mention people"] [role=option]')].find(n=>n.textContent.includes(${JSON.stringify(name)}))`;
    await page.waitFor(
      `(()=>{const i=${face("Alex")}.querySelector('img[src^="/api/avatar"]');return !!i&&i.complete&&i.naturalWidth>0})()`,
    );
    await page.waitFor(`!${face("Priya Raman")}.querySelector("img")`);
    expect(
      await page.eval(
        `${face("Priya Raman")}.querySelector("[data-avatar-fallback]")?.textContent`,
      ),
    ).toBe("P");
    await page.key("ArrowDown");
    expect(await page.eval<string>(options)).toBe("Audit user|*Alex|Priya Raman");
    await page.key("Tab");
    expect(await page.waitFor<string>(chips("#description"))).toBe("priya:@Priya Raman|alex:@Alex");

    await page.type("@au");
    await page.waitFor<string>(options);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[aria-label="Mention people"]')`);
    // Esc closed only the picker: the description keeps focus and the typed text.
    expect(
      await page.eval(`document.querySelector('#description').contains(document.activeElement)`),
    ).toBe(true);
    expect(await page.eval<string>(`document.querySelector('#description').textContent`)).toContain(
      "@au",
    );
  });

  await test.step("@ works in the comment composer too", async () => {
    await page.waitFor(`!!document.querySelector('#comment')`);
    await page.click("#comment");
    await page.type("Thanks @ale");
    expect(await page.waitFor<string>(options)).toBe("*Alex");
    await page.key("Enter");
    expect(await page.waitFor<string>(chips("#comment"))).toBe("alex:@Alex");
  });

  await test.step("@ in a new sub-issue's description suggests the parent issue's people, not the whole site", async () => {
    await page.eval("document.activeElement?.blur()");
    await page.key("o", "meta", "shift");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Sub-issue title'`);
    await page.click('[aria-label="Sub-issue description"]');
    await page.type("@");
    // Sam Outsider is only in the site-wide search; the parent's people search leaves them out.
    expect(await page.waitFor<string>(`${options}.split('|').length >= 3 && ${options}`)).toBe(
      "*Audit user|Alex|Priya Raman",
    );
  });
});
