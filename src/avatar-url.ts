/** Upgrade old mirror/cache URLs at display time as well as fresh Jira mappings. */
export function avatar48(url?: string): string | undefined {
  if (!url || !/^https?:\/\//.test(url)) return url;
  // Only the avatar CDN uses a trailing path segment for pixel size; Jira paths contain avatar IDs.
  const sized = /^https:\/\/[^/]+\.atl-paas\.net\//.test(url)
    ? url.replace(/\/24(?=$|\?)/, "/48")
    : url;
  return sized
    .replace(/([?&](?:s|size|w|h)=)24(?=&|$)/g, "$148")
    .replace(/([?&]size=)small(?=&|$)/g, "$1large");
}
export const jiraAvatar = (urls?: Record<string, string>) =>
  avatar48(urls?.["48x48"] ?? urls?.["24x24"]);
