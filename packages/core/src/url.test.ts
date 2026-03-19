import { describe, expect, it } from "vitest";
import { extractFeedCredentials } from "./url.js";

describe("extractFeedCredentials", () => {
  it("returns null credentials for URL without userinfo", () => {
    const result = extractFeedCredentials("https://example.com/feed.xml");
    expect(result.url).toBe("https://example.com/feed.xml");
    expect(result.credentials).toBeNull();
  });

  it("extracts and strips basic credentials", () => {
    const result = extractFeedCredentials("https://user:pass@example.com/feed.xml");
    expect(result.url).toBe("https://example.com/feed.xml");
    expect(result.credentials).toEqual({ username: "user", password: "pass" });
  });

  it("decodes URL-encoded credentials", () => {
    const result = extractFeedCredentials("https://user%40domain:p%40ss%3Aword@example.com/feed.xml");
    expect(result.url).toBe("https://example.com/feed.xml");
    expect(result.credentials).toEqual({ username: "user@domain", password: "p@ss:word" });
  });

  it("handles username-only (no password)", () => {
    const result = extractFeedCredentials("https://user@example.com/feed.xml");
    expect(result.url).toBe("https://example.com/feed.xml");
    expect(result.credentials).toEqual({ username: "user", password: "" });
  });

  it("preserves path, query, and fragment", () => {
    const result = extractFeedCredentials("https://user:pass@example.com/path/feed.xml?key=val#frag");
    expect(result.url).toBe("https://example.com/path/feed.xml?key=val#frag");
    expect(result.credentials).toEqual({ username: "user", password: "pass" });
  });

  it("preserves port", () => {
    const result = extractFeedCredentials("https://user:pass@example.com:8443/feed.xml");
    expect(result.url).toBe("https://example.com:8443/feed.xml");
    expect(result.credentials).toEqual({ username: "user", password: "pass" });
  });

  it("returns original URL string when no credentials", () => {
    const url = "http://example.com/rss?format=atom";
    const result = extractFeedCredentials(url);
    expect(result.url).toBe(url);
  });
});
