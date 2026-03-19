import type { Command } from "commander";

import { withNativeToken } from "../../auth.js";
import type { HeadrssApiClient } from "../../api-client.js";
import { printJson } from "../../utils.js";

export function registerFolderRemoveCommand(
  parent: Command,
  client: HeadrssApiClient,
): void {
  parent
    .command("rm")
    .argument("<id>", "Folder ID")
    .description("Delete a folder")
    .action(async (id: string) => {
      printJson(
        await withNativeToken(client, async (token) =>
          client.deleteFolder(token, Number.parseInt(id, 10))),
      );
    });
}
