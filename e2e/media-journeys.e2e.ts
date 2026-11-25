import type { Page } from "@playwright/test";
import { expect, test } from "./app";

const openIssue = async (page: Page, key: string, title: string) => {
  await page
    .getByRole("grid", { name: "Todo" })
    .getByRole("row", { name: `${key} ${title}`, exact: true })
    .getByText(title, { exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Issue title" })).toHaveValue(title);
};
const image = "scripts/fixtures/media-image.png";
const file = "scripts/fixtures/media-file.txt";
const saved = (page: Page) => expect(page.getByRole("status", { name: "Jira save status" })).toHaveText("Saved to Jira");
const description = (page: Page) => page.getByRole("textbox", { name: "Issue description" });
/** Picks `path` through a paperclip: the description's is the first, the comment box's the last. */
const attach = async (page: Page, which: "description" | "comment", path: string) => {
  const chooser = page.waitForEvent("filechooser");
  const clips = page.getByRole("button", { name: "Attach images, files, or videos" });
  await (which === "description" ? clips.first() : clips.last()).click();
  await (await chooser).setFiles(path);
};
/** The plain text of an ADF node. */
const text = (node: any): string => node?.text ?? (node?.content ?? []).map(text).join("");
/** Every media id an ADF document shows. */
const mediaIds = (node: any): string[] => [
  ...(node?.type === "media" && node.attrs?.id ? [String(node.attrs.id)] : []),
  ...(node?.content ?? []).flatMap(mediaIds),
];

test("44. an image uploaded into the description is in Jira's attachments and description, and survives a reload", async ({
  page,
  app,
}) => {
  await app.seed({ writable: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  await expect(description(page).getByRole("img", { name: "media-image.png" })).toHaveCount(0);

  await attach(page, "description", image);

  await expect(description(page).getByRole("img", { name: "media-image.png" })).toBeVisible();
  await expect.poll(app.uploads).toEqual([expect.objectContaining({ key: "TEST-2", name: "media-image.png" })]);
  await saved(page);
  const [upload] = await app.uploads();
  const { full } = await app.jiraIssue("TEST-2");
  expect(full.fields.attachment).toContainEqual(expect.objectContaining({ id: upload!.id, filename: "media-image.png" }));
  await expect.poll(async () => mediaIds((await app.jiraIssue("TEST-2")).full.fields.description)).toContain(upload!.mediaId);

  await page.reload();
  const shown = description(page).getByRole("img", { name: "media-image.png" });
  await expect(shown).toBeVisible();
  await expect.poll(() => shown.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
});

test("45. a file attached to a comment is posted with it to Jira and shows after a reload", async ({ page, app }) => {
  await app.seed({ writable: true, jiraComments: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  const box = page.getByRole("textbox", { name: "Leave a comment…" });

  await box.fill("Logs attached");
  await attach(page, "comment", file);
  await expect(box.getByText("media-file.txt")).toBeVisible();
  const send = page.getByRole("button", { name: "Submit comment" });
  await expect(send).toBeEnabled();
  await send.click();

  const comment = page.getByRole("listitem").filter({ hasText: "Logs attached" });
  await expect(comment.getByText("media-file.txt")).toBeVisible();
  await saved(page);
  await expect.poll(app.uploads).toEqual([expect.objectContaining({ key: "TEST-2", name: "media-file.txt" })]);
  const [upload] = await app.uploads();
  const { full } = await app.jiraIssue("TEST-2");
  expect(full.fields.attachment).toContainEqual(expect.objectContaining({ id: upload!.id, filename: "media-file.txt" }));
  const posted = (full.fields.comment.comments as any[]).filter((c) => text(c.body).includes("Logs attached"));
  expect(posted).toHaveLength(1);
  expect(mediaIds(posted[0].body)).toContain(upload!.mediaId);

  await page.reload();
  await expect(comment.getByText("media-file.txt")).toBeVisible();
  await expect(comment.getByRole("link", { name: "Download" })).toHaveAttribute(
    "href",
    new RegExp(`/api/issues/TEST-2/attachments/${upload!.id}`),
  );
});

test("46. Jira's images, videos and files render, and one that failed to load comes back with Retry", async ({ page, app }) => {
  await app.seed({ includeMedia: true });
  // The image's attachment lookup fails once, as when Jira's media service hiccups.
  const imageMedia = "**/api/issues/TEST-2/media/22222222-2222-4222-8222-222222222222";
  await page.route(imageMedia, (route) => route.fulfill({ status: 500, json: { error: "unavailable" } }));
  await openIssue(page, "TEST-2", "Browser fixture 2");

  await expect(description(page).getByRole("region", { name: "Media player" })).toBeVisible();
  await expect(description(page).getByRole("toolbar", { name: "File actions" })).toBeVisible();
  await expect(description(page).getByText("media-file.txt")).toBeVisible();
  const failed = description(page).getByRole("alert").filter({ hasText: "Could not load attachment" });
  await expect(failed).toBeVisible();
  await expect(description(page).getByRole("img", { name: "media-image.png" })).toHaveCount(0);

  await page.unroute(imageMedia);
  await failed.getByRole("button", { name: "Retry attachment" }).click();

  const shown = description(page).getByRole("img", { name: "media-image.png" });
  await expect(shown).toBeVisible();
  await expect(failed).toHaveCount(0);
  await shown.scrollIntoViewIfNeeded();
  await expect.poll(() => shown.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
});

test("47. the image viewer opens on an image and closes with its Close button or Escape", async ({ page, app }) => {
  await app.seed({ includeMedia: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  const shown = description(page).getByRole("img", { name: "media-image.png" });
  const viewer = page.getByRole("dialog", { name: "Preview" });

  await shown.hover();
  await page.getByRole("toolbar", { name: "Image actions" }).getByRole("button", { name: "Full screen" }).click();
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("img", { name: "media-image.png" })).toBeVisible();
  await viewer.getByRole("button", { name: "Close" }).click();
  await expect(viewer).toHaveCount(0);

  await shown.dblclick();
  await expect(viewer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Issue title" })).toHaveValue("Browser fixture 2");
});
