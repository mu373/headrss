import type { Command } from "commander";

import type { HeadrssApiClient } from "../../api-client.js";
import { getRetentionDays, requireEnv } from "../../config.js";
import { printJson } from "../../utils.js";

export function registerFeedPurgeCommand(
  parent: Command,
  client: HeadrssApiClient,
): void {
  parent
    .command("purge")
    .option("--retention-days <days>", "Override RETENTION_DAYS")
    .description("Purge old items")
    .action(async (options: { retentionDays?: string }) => {
      const retentionDays =
        options.retentionDays === undefined
          ? getRetentionDays()
          : Number.parseInt(options.retentionDays, 10);

      printJson(await client.purge(requireEnv("ADMIN_API_KEY"), retentionDays));
    });
}
