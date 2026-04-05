import type { Command } from "commander";

import type { HeadrssApiClient } from "../../api-client.js";
import { registerFeedFetchCommand } from "./fetch.js";
import { registerFeedPurgeCommand } from "./purge.js";

export function registerFeedCommands(
  parent: Command,
  client: HeadrssApiClient,
): void {
  const feed = parent.command("feed").description("Feed operations");
  registerFeedFetchCommand(feed, client);
  registerFeedPurgeCommand(feed, client);
}
