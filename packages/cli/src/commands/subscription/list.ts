import type { Command } from "commander";
import type { HeadrssApiClient } from "../../api-client.js";
import { withNativeToken } from "../../auth.js";
import { printJson } from "../../utils.js";

export function registerSubscriptionListCommand(
  parent: Command,
  client: HeadrssApiClient,
): void {
  parent
    .command("list")
    .description("List subscriptions")
    .action(async () => {
      printJson(
        await withNativeToken(client, async (token) =>
          client.listSubscriptions(token),
        ),
      );
    });
}
