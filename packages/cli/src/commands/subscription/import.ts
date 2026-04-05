import { readFile } from "node:fs/promises";

import type { Command } from "commander";
import type { HeadrssApiClient } from "../../api-client.js";
import { withNativeToken } from "../../auth.js";
import { printJson } from "../../utils.js";

export function registerSubscriptionImportCommand(
  parent: Command,
  client: HeadrssApiClient,
): void {
  parent
    .command("import")
    .argument("<file>", "Path to OPML file")
    .description("Import subscriptions from an OPML file")
    .action(async (file: string) => {
      const contents = await readFile(file, "utf8");
      const result = await withNativeToken(client, async (token) =>
        client.importOpmlNative(token, contents),
      );
      printJson(result);
    });
}
