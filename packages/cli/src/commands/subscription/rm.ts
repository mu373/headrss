import type { Command } from "commander";
import type { HeadrssApiClient } from "../../api-client.js";
import { withNativeToken } from "../../auth.js";
import { printJson } from "../../utils.js";

export function registerSubscriptionRemoveCommand(
  parent: Command,
  client: HeadrssApiClient,
): void {
  parent
    .command("rm")
    .argument("<id>", "Subscription ID")
    .description("Remove a subscription")
    .action(async (id: string) => {
      printJson(
        await withNativeToken(client, async (token) =>
          client.deleteSubscription(token, Number.parseInt(id, 10)),
        ),
      );
    });
}
