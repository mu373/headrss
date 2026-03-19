import { loginAndCache } from "../auth.js";
import type { HeadrssApiClient } from "../api-client.js";
import { printJson } from "../utils.js";

export async function runLoginCommand(client: HeadrssApiClient): Promise<void> {
  const token = await loginAndCache(client);

  printJson({
    expiresAt: token.expiresAt,
    ok: true,
    username: token.username,
  });
}
