import type { Command } from "commander";

import { withNativeToken } from "../../auth.js";
import type { HeadrssApiClient } from "../../api-client.js";
import { printJson } from "../../utils.js";

export function registerFolderListCommand(
  parent: Command,
  client: HeadrssApiClient,
): void {
  parent
    .command("list")
    .description("List folders")
    .action(async () => {
      printJson(await withNativeToken(client, async (token) => client.listFolders(token)));
    });
}
