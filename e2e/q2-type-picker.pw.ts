import { expect, fixture, test } from "./app";

const typeMenu = '[role="dialog"][aria-label="Change issue type"]';
const choices = `[...document.querySelectorAll('${typeMenu} [cmdk-item]')].map(item => item.getAttribute('data-value'))`;

test("Issue options opens the same type picker as the issue property", async ({
  open,
}) => {
  await fixture.reset({ writable: true, subtask: true });
  const page = await open("?issue=TEST-2&view=page");
  await page.waitFor(`!!document.getElementById('prop-type')`);
  await page.click("#prop-type");
  await page.waitFor(`!!document.querySelector('${typeMenu}')`);
  const propertyChoices = await page.eval(choices);
  expect(propertyChoices).toEqual(["Task", "Story"]);
  await page.key("Escape");
  await page.click("#issue-options");
  await page.click('[cmdk-item][data-value="Issue type"]');
  await page.waitFor(`!!document.querySelector('${typeMenu}')`);
  expect(await page.eval(choices)).toEqual(propertyChoices);
  await page.click(`${typeMenu} [cmdk-item][data-value="Story"]`);
  await page.waitFor(
    `document.getElementById('prop-type')?.textContent==='Story'`,
  );
  expect(await page.eval(`!!document.querySelector('${typeMenu}')`)).toBe(
    false,
  );
});
