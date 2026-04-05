import type { AppPassword, EntryStore, User } from "@headrss/core";
import { describe, expect, it, vi } from "vitest";

import { LocalAuthProvider } from "../auth/local-auth-provider.js";

const encoder = new TextEncoder();

describe("LocalAuthProvider", () => {
  it("validates both legacy sha256 hashes and new pbkdf2 hashes", async () => {
    const user: User = {
      id: 1,
      username: "alice",
      email: null,
      createdAt: 0,
    };
    const appPasswords: AppPassword[] = [
      {
        id: 11,
        userId: user.id,
        label: "legacy",
        passwordHash: await createLegacyHash("legacy-secret", "legacy-salt"),
        passwordVersion: 2,
        lastUsedAt: null,
        createdAt: 0,
      },
      {
        id: 12,
        userId: user.id,
        label: "modern",
        passwordHash: await createPbkdf2Hash(
          "modern-secret",
          100_000,
          "modern-salt",
        ),
        passwordVersion: 3,
        lastUsedAt: null,
        createdAt: 0,
      },
    ];
    const touchedIds: number[] = [];
    const store = createAuthStore(user, appPasswords, touchedIds);
    const provider = new LocalAuthProvider(store as EntryStore);

    await expect(
      provider.validateCredentials("alice", "legacy-secret"),
    ).resolves.toEqual({
      userId: user.id,
      appPasswordId: 11,
      passwordVersion: 2,
    });
    await expect(
      provider.validateCredentials("alice", "modern-secret"),
    ).resolves.toEqual({
      userId: user.id,
      appPasswordId: 12,
      passwordVersion: 3,
    });
    expect(touchedIds).toEqual([11, 12]);
  });

  it("checks user ownership when validating password versions", async () => {
    const user: User = {
      id: 1,
      username: "alice",
      email: null,
      createdAt: 0,
    };
    const appPassword: AppPassword = {
      id: 22,
      userId: user.id,
      label: "modern",
      passwordHash: await createPbkdf2Hash("secret", 100_000, "salt"),
      passwordVersion: 4,
      lastUsedAt: null,
      createdAt: 0,
    };
    const store = createAuthStore(user, [appPassword], []);
    const provider = new LocalAuthProvider(store as EntryStore);

    await expect(
      provider.validatePasswordVersion(user.id, appPassword.id, 4),
    ).resolves.toBe(true);
    await expect(
      provider.validatePasswordVersion(user.id + 1, appPassword.id, 4),
    ).resolves.toBe(false);
  });
});

function createAuthStore(
  user: User,
  appPasswords: AppPassword[],
  touchedIds: number[],
): Pick<
  EntryStore,
  | "getAppPasswordById"
  | "getUserByUsername"
  | "listAppPasswordsByUserId"
  | "touchAppPassword"
> {
  return {
    getAppPasswordById: vi.fn(
      async (id: number) =>
        appPasswords.find((appPassword) => appPassword.id === id) ?? null,
    ),
    getUserByUsername: vi.fn(async (username: string) =>
      username === user.username ? user : null,
    ),
    listAppPasswordsByUserId: vi.fn(async (userId: number) =>
      appPasswords.filter((appPassword) => appPassword.userId === userId),
    ),
    touchAppPassword: vi.fn(async (id: number) => {
      touchedIds.push(id);
      return true;
    }),
  };
}

async function createLegacyHash(
  password: string,
  salt: string,
): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(`${salt}:${password}`),
    ),
  );
  return `sha256$${salt}$${toBase64Url(digest)}`;
}

async function createPbkdf2Hash(
  password: string,
  iterations: number,
  saltText: string,
): Promise<string> {
  const salt = encoder.encode(saltText);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt,
        iterations,
      },
      key,
      256,
    ),
  );
  return `pbkdf2$${iterations}$${toBase64Url(salt)}$${toBase64Url(digest)}`;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
