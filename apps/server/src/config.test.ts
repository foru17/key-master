import { describe, expect, it } from "vitest";
import { resourceSchema, SCOPE_ITEM_PATTERN, SLUG_PATTERN } from "./config.js";

describe("slug patterns", () => {
  it.each([
    ["/clash", true],
    ["/sub-example.yaml", true],
    ["/feeds/daily.txt", true],
    ["/.well-known-ish", true],
    ["/a..b", true],
    ["/", false],
    ["/.", false],
    ["/..", false],
    ["/a/../b", false],
    ["/./x", false],
    ["/a/.", false],
    ["/a b", false],
    ["clash", false],
  ])("slug %s → %s", (slug, ok) => {
    expect(SLUG_PATTERN.test(slug)).toBe(ok);
    expect(SCOPE_ITEM_PATTERN.test(slug)).toBe(ok);
  });

  it("scope accepts the wildcard, slugs do not", () => {
    expect(SCOPE_ITEM_PATTERN.test("*")).toBe(true);
    expect(SLUG_PATTERN.test("*")).toBe(false);
  });

  it("resource schema accepts dotted file slugs", () => {
    const r = resourceSchema.safeParse({
      slug: "/sub-example.yaml",
      kind: "file",
      source: "sub-example.yaml",
      content_type: "text/plain",
      policy: "approval",
    });
    expect(r.success).toBe(true);
  });
});
