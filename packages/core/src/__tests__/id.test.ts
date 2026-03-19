import { describe, expect, it } from "vitest";

import { generatePublicId } from "../id.js";

describe("generatePublicId", () => {
  it("returns a deterministic 22-character base62 identifier", () => {
    const id = generatePublicId("https://example.com/feed.xml", "entry-1");

    expect(id).toBe("2IUZDXyF0Tm3uJPjDyYWPT");
    expect(id).toHaveLength(22);
    expect(id).toMatch(/^[0-9A-Za-z]{22}$/);
    expect(generatePublicId("https://example.com/feed.xml", "entry-1")).toBe(
      id,
    );
  });

  it("changes when the GUID changes", () => {
    expect(
      generatePublicId("https://example.com/feed.xml", "entry-1"),
    ).not.toBe(generatePublicId("https://example.com/feed.xml", "entry-2"));
  });
});
