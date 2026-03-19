import type { Command } from "commander";

import type { HeadrssApiClient } from "../../api-client.js";
import { requireEnv } from "../../config.js";
import { printJson } from "../../utils.js";

export function registerAdminFeedCommands(
  parent: Command,
  client: HeadrssApiClient,
): void {
  const feed = parent.command("feed").description("Manage feeds");
  const getApiKey = (): string => requireEnv("ADMIN_API_KEY");

  feed
    .command("list")
    .description("List feeds")
    .action(async () => {
      printJson(await client.listFeeds(getApiKey()));
    });

  feed
    .command("rm")
    .argument("<id>", "Feed ID")
    .description("Delete a feed")
    .action(async (id: string) => {
      printJson(await client.deleteFeed(getApiKey(), Number.parseInt(id, 10)));
    });
}
