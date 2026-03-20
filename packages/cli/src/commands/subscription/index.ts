import type { Command } from "commander";

import type { HeadrssApiClient } from "../../api-client.js";
import { registerSubscriptionAddCommand } from "./add.js";
import { registerSubscriptionExportCommand } from "./export.js";
import { registerSubscriptionImportCommand } from "./import.js";
import { registerSubscriptionListCommand } from "./list.js";
import { registerSubscriptionRemoveCommand } from "./rm.js";

export function registerSubscriptionCommands(
  parent: Command,
  client: HeadrssApiClient,
): void {
  const subscription = parent.command("subscription").description("Manage subscriptions");
  registerSubscriptionListCommand(subscription, client);
  registerSubscriptionAddCommand(subscription, client);
  registerSubscriptionRemoveCommand(subscription, client);
  registerSubscriptionImportCommand(subscription, client);
  registerSubscriptionExportCommand(subscription, client);
}
