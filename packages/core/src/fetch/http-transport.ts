import type {
  FetchTransport,
  TransportOptions,
  TransportResult,
} from "../ports/fetch-transport.js";

export interface HttpTransportResult extends TransportResult {
  redirectedPermanently: boolean;
  redirectChain: string[];
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SAFE_CROSS_ORIGIN_HEADERS = new Set([
  "accept",
  "if-modified-since",
  "if-none-match",
  "user-agent",
]);

export class HttpFetchTransport implements FetchTransport {
  async fetch(
    url: string,
    options: TransportOptions,
  ): Promise<HttpTransportResult> {
    let headers = new Headers(options.headers);
    const parsed = new URL(url);
    if (parsed.username) {
      const credentials = btoa(
        `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`,
      );
      headers.set("Authorization", `Basic ${credentials}`);
      parsed.username = "";
      parsed.password = "";
    }
    const redirectChain: string[] = [];
    let currentUrl = parsed.toString();
    let redirectedPermanently = false;

    for (
      let redirectCount = 0;
      redirectCount <= options.maxRedirects;
      redirectCount += 1
    ) {
      const response = await this.fetchOnce(
        currentUrl,
        headers,
        options.timeout,
      );

      if (!REDIRECT_STATUSES.has(response.status)) {
        return {
          body: response.status === 304 ? "" : await response.text(),
          finalUrl: response.url || currentUrl,
          headers: collectHeaders(response.headers),
          redirectChain,
          redirectedPermanently,
          status: response.status,
        };
      }

      const location = response.headers.get("location");

      if (location === null) {
        throw new Error(
          `Redirect response from ${currentUrl} did not include a Location header.`,
        );
      }

      if (redirectCount === options.maxRedirects) {
        throw new Error(
          `Exceeded redirect limit (${options.maxRedirects}) for ${url}.`,
        );
      }

      const nextUrl = new URL(location, currentUrl).toString();
      headers = isSameOrigin(currentUrl, nextUrl)
        ? headers
        : copySafeCrossOriginHeaders(headers);
      redirectedPermanently ||=
        response.status === 301 || response.status === 308;
      redirectChain.push(nextUrl);
      currentUrl = nextUrl;
    }

    throw new Error(
      `Exceeded redirect limit (${options.maxRedirects}) for ${url}.`,
    );
  }

  private async fetchOnce(
    url: string,
    headers: Headers,
    timeout: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      return await fetch(url, {
        headers,
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Timed out fetching ${url} after ${timeout}ms.`);
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function collectHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

function isSameOrigin(fromUrl: string, toUrl: string): boolean {
  return new URL(fromUrl).origin === new URL(toUrl).origin;
}

function copySafeCrossOriginHeaders(headers: Headers): Headers {
  const safeHeaders = new Headers();

  for (const [name, value] of headers.entries()) {
    if (SAFE_CROSS_ORIGIN_HEADERS.has(name.toLowerCase())) {
      safeHeaders.set(name, value);
    }
  }

  return safeHeaders;
}
