import type { Command } from "commander";

import type { HeadrssApiClient } from "../../api-client.js";
import { requireEnv } from "../../config.js";
import { printJson } from "../../utils.js";

export function registerAdminUserCommands(
  parent: Command,
  client: HeadrssApiClient,
): void {
  const user = parent.command("user").description("Manage users");
  const getApiKey = (): string => requireEnv("ADMIN_API_KEY");

  user
    .command("list")
    .description("List users")
    .action(async () => {
      printJson(await client.listUsers(getApiKey()));
    });

  user
    .command("add")
    .argument("<username>", "Username")
    .option("--email <email>", "Email address")
    .description("Create a user")
    .action(async (username: string, options: { email?: string }) => {
      printJson(await client.addUser(getApiKey(), username, options.email));
    });

  user
    .command("rm")
    .argument("<id>", "User ID")
    .description("Delete a user")
    .action(async (id: string) => {
      printJson(await client.deleteUser(getApiKey(), Number.parseInt(id, 10)));
    });
}
