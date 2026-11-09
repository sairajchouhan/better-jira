import { expect, test } from "bun:test";
import { typedResourceURL } from "./issue-resource";

test("R2-issue-fields-D10: a typed bare domain links over https; other schemes stay rejected", () => {
  expect(typedResourceURL("example.com/qa-if2")).toBe("https://example.com/qa-if2");
  expect(typedResourceURL(" example.com:8080/x ")).toBe("https://example.com:8080/x");
  expect(typedResourceURL("http://example.com/a")).toBe("http://example.com/a");
  expect(typedResourceURL("javascript:alert(1)")).toBeNull();
  expect(typedResourceURL("ftp://example.com")).toBeNull();
  expect(typedResourceURL("not a link")).toBeNull();
});
