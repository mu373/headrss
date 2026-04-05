import type { Command } from "commander";
import type { HeadrssApiClient } from "../../api-client.js";
import { withNativeToken } from "../../auth.js";
import { printJson } from "../../utils.js";

export function registerFolderListCommand(
  parent: Command,
  client: HeadrssApiClient,
): void {
  parent
    .command("list")
    .description("List folders")
    .action(async () => {
      printJson(
        await withNativeToken(client, async (token) =>
          client.listFolders(token),
        ),
      );
    });
}
