import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import type { Command } from "commander";

import type { HeadrssApiClient } from "../../api-client.js";
import { requireEnv } from "../../config.js";
import { printJson, printText } from "../../utils.js";

export function registerAdminPasswordCommands(
  parent: Command,
  client: HeadrssApiClient,
): void {
  const password = parent.command("password").description("Manage app passwords");
  const getApiKey = (): string => requireEnv("ADMIN_API_KEY");

  password
    .command("list")
    .argument("<userId>", "User ID")
    .description("List app passwords for a user")
    .action(async (userId: string) => {
      printJson(await client.listAppPasswords(getApiKey(), Number.parseInt(userId, 10)));
    });

  password
    .command("add")
    .argument("<userId>", "User ID")
    .option("--label <label>", "Password label")
    .description("Create an app password")
    .action(async (userId: string, options: { label?: string }) => {
      const label = options.label ?? await promptLabel();
      const created = await client.addAppPassword(
        getApiKey(),
        Number.parseInt(userId, 10),
        label,
      );

      printText(`plaintext_password: ${created.plaintext_password}`);
      printJson(created.app_password);
    });

  password
    .command("rm")
    .argument("<id>", "App password ID")
    .description("Delete an app password")
    .action(async (id: string) => {
      printJson(await client.deleteAppPassword(getApiKey(), Number.parseInt(id, 10)));
    });
}

async function promptLabel(): Promise<string> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("Missing password label. Pass --label for non-interactive use.");
  }

  const rl = createInterface({ input, output });

  try {
    const value = (await rl.question("Password label: ")).trim();

    if (value.length === 0) {
      throw new Error("Password label is required.");
    }

    return value;
  } finally {
    rl.close();
  }
}
