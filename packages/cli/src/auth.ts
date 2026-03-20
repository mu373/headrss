import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { HeadrssApiClient, ApiClientError } from "./api-client.js";
import { getEnv } from "./config.js";
import { getEnvironmentName, getLegacyTokenCachePath, getTokenCachePath } from "./profile.js";

interface CachedToken {
  expiresAt: number;
  token: string;
  username: string;
}

const TOKEN_EXPIRY_SKEW_SECONDS = 30;

export async function loginAndCache(
  client: HeadrssApiClient,
  credentials?: {
    password: string;
    username: string;
  },
): Promise<CachedToken> {
  const resolved = credentials ?? await resolveCredentials();
  const token = await client.exchangeToken(resolved.username, resolved.password);
  const cached: CachedToken = {
    expiresAt: Math.floor(Date.now() / 1000) + token.expiresIn,
    token: token.token,
    username: resolved.username,
  };

  await writeCachedToken(cached);
  return cached;
}

export async function ensureNativeToken(client: HeadrssApiClient): Promise<string> {
  const cached = await readCachedToken();

  if (cached !== null && isTokenValid(cached)) {
    return cached.token;
  }

  const refreshed = await loginAndCache(client);
  return refreshed.token;
}

export async function withNativeToken<T>(
  client: HeadrssApiClient,
  operation: (token: string) => Promise<T>,
): Promise<T> {
  let token = await ensureNativeToken(client);

  try {
    return await operation(token);
  } catch (error) {
    if (!(error instanceof ApiClientError) || error.status !== 401) {
      throw error;
    }
  }

  await clearCachedToken();
  token = (await loginAndCache(client)).token;
  return operation(token);
}

export async function clearCachedToken(): Promise<void> {
  await rm(getTokenCachePath(), { force: true });
}

export async function readCachedToken(): Promise<CachedToken | null> {
  try {
    return await readCachedTokenFromPath(getTokenCachePath());
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" &&
      getEnvironmentName() === "default"
    ) {
      try {
        return await readCachedTokenFromPath(getLegacyTokenCachePath());
      } catch (legacyError) {
        if ((legacyError as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }

        throw legacyError;
      }
    }

    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function writeCachedToken(token: CachedToken): Promise<void> {
  const tokenCachePath = getTokenCachePath();
  await mkdir(dirname(tokenCachePath), { recursive: true });
  await writeFile(tokenCachePath, `${JSON.stringify(token, null, 2)}\n`, "utf8");
}

export function isTokenValid(token: CachedToken, now = Math.floor(Date.now() / 1000)): boolean {
  return token.expiresAt > now + TOKEN_EXPIRY_SKEW_SECONDS;
}

async function readCachedTokenFromPath(path: string): Promise<CachedToken | null> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as Partial<CachedToken>;

  if (
    typeof parsed.token !== "string" ||
    typeof parsed.username !== "string" ||
    typeof parsed.expiresAt !== "number"
  ) {
    return null;
  }

  return {
    expiresAt: parsed.expiresAt,
    token: parsed.token,
    username: parsed.username,
  };
}

async function resolveCredentials(): Promise<{
  password: string;
  username: string;
}> {
  const envUsername = getEnv("HEADRSS_USER");
  const envPassword = getEnv("HEADRSS_PASSWORD");

  if (envUsername !== undefined && envPassword !== undefined) {
    return {
      password: envPassword,
      username: envUsername,
    };
  }

  const cached = await readCachedToken();
  const username = envUsername ?? await promptLine("Username", cached?.username);
  const password = envPassword ?? await promptPassword("App password");

  return { password, username };
}

async function promptLine(label: string, initialValue?: string): Promise<string> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error(`Missing ${label}. Set HEADRSS_USER and HEADRSS_PASSWORD for non-interactive use.`);
  }

  const rl = createInterface({ input, output });
  const suffix = initialValue === undefined ? "" : ` [${initialValue}]`;

  try {
    const value = (await rl.question(`${label}${suffix}: `)).trim();
    return value.length > 0 ? value : (initialValue ?? "");
  } finally {
    rl.close();
  }
}

async function promptPassword(label: string): Promise<string> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error(`Missing ${label}. Set HEADRSS_USER and HEADRSS_PASSWORD for non-interactive use.`);
  }

  return new Promise((resolve, reject) => {
    let value = "";
    const onData = (chunk: Buffer | string): void => {
      const data = String(chunk);

      for (const char of data) {
        if (char === "\u0003") {
          cleanup();
          reject(new Error("Input cancelled."));
          return;
        }

        if (char === "\r" || char === "\n") {
          output.write("\n");
          cleanup();
          resolve(value);
          return;
        }

        if (char === "\u007f" || char === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            output.write("\b \b");
          }
          continue;
        }

        value += char;
        output.write("*");
      }
    };

    const cleanup = (): void => {
      input.off("data", onData);
      input.setRawMode?.(false);
      input.pause();
    };

    output.write(`${label}: `);
    input.resume();
    input.setRawMode?.(true);
    input.on("data", onData);
  });
}
