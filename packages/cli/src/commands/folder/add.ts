import type { Command } from "commander";

import { withNativeToken } from "../../auth.js";
import type { HeadrssApiClient } from "../../api-client.js";
import { printJson } from "../../utils.js";

export function registerFolderAddCommand(
  parent: Command,
  client: HeadrssApiClient,
): void {
  parent
    .command("add")
    .argument("<name>", "Folder name")
    .description("Create a folder")
    .action(async (name: string) => {
      printJson(await withNativeToken(client, async (token) => client.addFolder(token, name)));
    });
}
