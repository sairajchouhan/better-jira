import { resourceURL } from "@/shared/issue-resource";

/** At most this many bytes of a pasted web image are fetched (Linear's `uploadFileFromUrl`, server side). */
const MAX_BYTES = 25 * 1024 * 1024;

/** A web image pasted into an editor, fetched here because most image hosts send no CORS headers. Only http(s) images. */
export async function remoteImage(url: string): Promise<Response> {
  const href = resourceURL(url);
  if (!href) return new Response("Not an image URL", { status: 400 });
  try {
    const response = await fetch(href, { signal: AbortSignal.timeout(10_000), headers: { accept: "image/*" } });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.startsWith("image/")) return new Response("Not an image", { status: 415 });
    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return new Response("Image too large", { status: 413 });
    return new Response(body, { headers: { "content-type": type } });
  } catch {
    return new Response("Could not fetch the image", { status: 502 });
  }
}
