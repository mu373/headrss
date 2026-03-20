import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getEnvironmentEnvFilePath } from "./profile.js";

/**
 * Load env files into process.env. Existing env vars take precedence.
 * Profile env file is loaded first (higher priority), then .env from cwd walk.
 */
export function loadEnvFile(): void {
  const profileEnvFilePath = getEnvironmentEnvFilePath();
  if (existsSync(profileEnvFilePath)) {
    applyEnvFileContents(readFileSync(profileEnvFilePath, "utf-8"));
  }

  const filePath = findEnvFile();
  if (filePath !== undefined) {
    applyEnvFileContents(readFileSync(filePath, "utf-8"));
  }
}

export function applyEnvFileContents(content: string): void {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const rawKey = trimmed.slice(0, eqIndex).trim();
    const key = rawKey.startsWith("export ") ? rawKey.slice("export ".length).trim() : rawKey;

    if (key === "") continue;

    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Existing env vars take precedence
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function findEnvFile(): string | undefined {
  let dir = resolve(".");

  while (true) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) return candidate;

    const parent = resolve(dir, "..");
    if (parent === dir) return undefined;
    dir = parent;
  }
}
