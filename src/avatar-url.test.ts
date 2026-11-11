import { expect, test } from "bun:test";
import { jiraAvatar } from "./avatar-url";
import { avatarSrc } from "./avatar-proxy";

test("48px Jira mapping and existing 24px mirror URLs both load larger photos through the proxy", () => {
  const old =
    "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/account/photo/24";
  const large = old.replace("/24", "/48");
  expect(jiraAvatar({ "24x24": old, "48x48": large })).toBe(large);
  expect(jiraAvatar({ "24x24": old })).toBe(large);
  for (const [before, after] of [
    [old, large],
    [
      "https://example.atlassian.net/avatar/24?size=small",
      "https://example.atlassian.net/avatar/24?size=large",
    ],
    [
      "https://secure.gravatar.com/avatar/hash?s=24&d=mm",
      "https://secure.gravatar.com/avatar/hash?s=48&d=mm",
    ],
    [
      "https://example.atlassian.net/avatar/1?size=small",
      "https://example.atlassian.net/avatar/1?size=large",
    ],
  ])
    expect(avatarSrc(before)).toBe("/api/avatar?url=" + encodeURIComponent(after!));
  expect(jiraAvatar(undefined)).toBeUndefined();
});
