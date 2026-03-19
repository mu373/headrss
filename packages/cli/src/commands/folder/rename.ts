import type { Command } from "commander";

import { withNativeToken } from "../../auth.js";
import type { HeadrssApiClient } from "../../api-client.js";
import { printJson } from "../../utils.js";

export function registerFolderRenameCommand(
  parent: Command,
  client: HeadrssApiClient,
): void {
  parent
    .command("rename")
    .argument("<id>", "Folder ID")
    .argument("<name>", "New folder name")
    .description("Rename a folder")
    .action(async (id: string, name: string) => {
      printJson(
        await withNativeToken(client, async (token) =>
          client.renameFolder(token, Number.parseInt(id, 10), name)),
      );
    });
}
