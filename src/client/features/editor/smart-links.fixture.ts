import type { AdfDocument } from "@/shared/document";

/** BJ-16: every smart-link kind the survey found, with Jira's resolver data and node ids, in all three card nodes. */
export const smartLinksFixture: AdfDocument = {
  type: "doc",
  version: 1,
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "See " },
        { type: "inlineCard", attrs: { url: "https://example.atlassian.net/browse/TEST-2" } },
        { type: "text", text: " and " },
        { type: "inlineCard", attrs: { url: "https://github.com/acme/widgets/pull/42", data: { "@type": "Document", name: "Fix the widget" }, localId: "card-1" } },
        { type: "inlineCard", attrs: { url: "https://example.atlassian.net/wiki/spaces/ENG/pages/123456/Release+checklist" } },
      ],
    },
    { type: "blockCard", attrs: { url: "https://docs.google.com/document/d/abc/edit", layout: "wide", width: 80 } },
    { type: "embedCard", attrs: { url: "https://example.com/handbook", layout: "center", originalHeight: 300 } },
  ],
};
