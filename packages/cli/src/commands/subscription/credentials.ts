import type { Command } from "commander";
import type { HeadrssApiClient } from "../../api-client.js";
import { withNativeToken } from "../../auth.js";
import { printJson } from "../../utils.js";

export function registerSubscriptionCredentialsCommand(
  parent: Command,
  client: HeadrssApiClient,
): void {
  parent
    .command("credentials")
    .argument("<id>", "Subscription ID")
    .option("--username <username>", "Username for basic auth")
    .option("--password <password>", "Password for basic auth")
    .option("--clear", "Remove stored credentials")
    .description("Set or clear feed credentials for a subscription")
    .action(
      async (
        id: string,
        options: { username?: string; password?: string; clear?: boolean },
      ) => {
        const subscriptionId = Number.parseInt(id, 10);

        if (
          options.clear &&
          (options.username !== undefined || options.password !== undefined)
        ) {
          throw new Error("Cannot use --clear with --username or --password.");
        }

        if (options.clear) {
          printJson(
            await withNativeToken(client, async (token) =>
              client.deleteSubscriptionCredentials(token, subscriptionId),
            ),
          );
          return;
        }

        if (options.username === undefined) {
          throw new Error(
            "Missing --username. Use --clear to remove credentials.",
          );
        }

        if (options.password === undefined) {
          throw new Error("Missing --password.");
        }

        printJson(
          await withNativeToken(client, async (token) =>
            client.setSubscriptionCredentials(token, subscriptionId, {
              password: options.password!,
              username: options.username!,
            }),
          ),
        );
      },
    );
}
