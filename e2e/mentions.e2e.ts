import { afterAll, expect, test } from "bun:test";
import { open, stop } from "./harness";
afterAll(stop);

const chips = (editor: string) =>
  `[...document.querySelectorAll('${editor} .mention-chip')].map(n=>n.dataset.mentionId+':'+n.textContent).join('|')`;
const options = `[...document.querySelectorAll('[aria-label="Mention people"] [role=option]')].map(n=>(n.ariaSelected==='true'?'*':'')+n.lastElementChild.textContent).join('|')`;

test("@ in the description opens the people picker; keys filter, choose and dismiss", async () => {
  const page = await open("?issue=TEST-2&view=page");
  try {
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
  } finally {
    await page.close();
  }
});

test("@ works in the comment composer too", async () => {
  const page = await open("?issue=TEST-2&view=page");
  try {
    await page.waitFor(`!!document.querySelector('#comment')`);
    await page.click("#comment");
    await page.type("Thanks @ale");
    expect(await page.waitFor<string>(options)).toBe("*Alex");
    await page.key("Enter");
    expect(await page.waitFor<string>(chips("#comment"))).toBe("alex:@Alex");
  } finally {
    await page.close();
  }
});
