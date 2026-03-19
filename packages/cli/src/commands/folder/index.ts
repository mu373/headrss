import type { Command } from "commander";

import type { HeadrssApiClient } from "../../api-client.js";
import { registerFolderAddCommand } from "./add.js";
import { registerFolderListCommand } from "./list.js";
import { registerFolderRemoveCommand } from "./rm.js";

export function registerFolderCommands(parent: Command, client: HeadrssApiClient): void {
  const folder = parent.command("folder").description("Manage folders");
  registerFolderListCommand(folder, client);
  registerFolderAddCommand(folder, client);
  registerFolderRemoveCommand(folder, client);
}
