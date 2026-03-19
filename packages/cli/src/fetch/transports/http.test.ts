import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpFetchTransport } from "./http.js";

describe("HttpFetchTransport", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("strips credential-bearing headers on cross-origin redirects", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("", {
          status: 302,
          headers: {
            location: "https://other.example.com/feed.xml",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response("ok", {
          status: 200,
          headers: {
            "content-type": "text/plain",
          },
        }),
      );

    globalThis.fetch = fetchMock;

    const transport = new HttpFetchTransport();
    await transport.fetch("https://example.com/feed.xml", {
      headers: {
        Accept: "application/rss+xml",
        Authorization: "Bearer secret",
        Cookie: "session=abc",
        "If-None-Match": '"etag"',
        "User-Agent": "HeadRSS",
      },
      maxRedirects: 5,
      timeout: 1_000,
    });

    const firstHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    const secondHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);

    expect(firstHeaders.get("authorization")).toBe("Bearer secret");
    expect(firstHeaders.get("cookie")).toBe("session=abc");
    expect(secondHeaders.get("authorization")).toBeNull();
    expect(secondHeaders.get("cookie")).toBeNull();
    expect(secondHeaders.get("accept")).toBe("application/rss+xml");
    expect(secondHeaders.get("if-none-match")).toBe('"etag"');
    expect(secondHeaders.get("user-agent")).toBe("HeadRSS");
  });

  it("keeps headers on same-origin redirects", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("", {
          status: 302,
          headers: {
            location: "/redirected.xml",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response("ok", {
          status: 200,
        }),
      );

    globalThis.fetch = fetchMock;

    const transport = new HttpFetchTransport();
    await transport.fetch("https://example.com/feed.xml", {
      headers: {
        Authorization: "Bearer secret",
      },
      maxRedirects: 5,
      timeout: 1_000,
    });

    const secondHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(secondHeaders.get("authorization")).toBe("Bearer secret");
  });
});
