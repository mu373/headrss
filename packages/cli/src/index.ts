#!/usr/bin/env bun

import { loadEnvFile } from "./env.js";
import { initProfile } from "./profile.js";

const earlyEnvName = parseEarlyEnvironmentName(process.argv);

initProfile(earlyEnvName);

loadEnvFile();

import { Command } from "commander";

import { HeadrssApiClient } from "./api-client.js";
import { runLoginCommand } from "./commands/login.js";
import { registerAdminFeedCommands } from "./commands/admin/feed.js";
import { registerAdminOpmlCommands } from "./commands/admin/opml.js";
import { registerAdminPasswordCommands } from "./commands/admin/password.js";
import { registerAdminUserCommands } from "./commands/admin/user.js";
import { registerFeedCommands } from "./commands/feed/index.js";
import { registerFolderCommands } from "./commands/folder/index.js";
import { registerSubscriptionCommands } from "./commands/subscription/index.js";
import { createLogger } from "./log.js";
import { toErrorMessage } from "./utils.js";
import { VERSION } from "@headrss/core";

const program = new Command();
const client = new HeadrssApiClient();

program
  .name("headrss")
  .description("HeadRSS CLI")
  .version(VERSION)
  .option("--env <name>", "Environment profile name")
  .showHelpAfterError();

program
  .command("login")
  .description("Exchange username + app password for a native API token and cache it locally")
  .action(async () => {
    await runLoginCommand(client);
  });

registerSubscriptionCommands(program, client);
registerFolderCommands(program, client);
registerFeedCommands(program, client);

const admin = program.command("admin").description("Admin API commands");
registerAdminUserCommands(admin, client);
registerAdminPasswordCommands(admin, client);
registerAdminFeedCommands(admin, client);
registerAdminOpmlCommands(admin, client);

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const logger = createLogger();
  logger.error(toErrorMessage(error));
  process.exitCode = 1;
}

function parseEarlyEnvironmentName(argv: string[]): string | undefined {
  const envFlagIndex = argv.indexOf("--env");
  if (envFlagIndex !== -1) {
    const value = argv[envFlagIndex + 1];
    if (value === undefined || value.startsWith("-")) {
      throw new Error("Missing value for --env.");
    }

    return value;
  }

  const envArg = argv.find((arg) => arg.startsWith("--env="));
  if (envArg !== undefined) {
    const value = envArg.slice("--env=".length);
    if (value.length === 0) {
      throw new Error("Missing value for --env.");
    }

    return value;
  }

  return undefined;
}
