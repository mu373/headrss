import { readFile } from "node:fs/promises";

import type { Command } from "commander";

import type { HeadrssApiClient } from "../../api-client.js";
import { requireEnv } from "../../config.js";
import { printJson, writeTextFileEnsuringParent } from "../../utils.js";

export function registerAdminOpmlCommands(
  parent: Command,
  client: HeadrssApiClient,
): void {
  const opml = parent.command("opml").description("Import or export OPML");
  const getApiKey = (): string => requireEnv("ADMIN_API_KEY");

  opml
    .command("import")
    .argument("<file>", "Path to OPML file")
    .requiredOption("--user <id>", "User ID")
    .description("Import OPML for a user")
    .action(async (file: string, options: { user: string }) => {
      const contents = await readFile(file, "utf8");
      const result = await client.importOpml(
        getApiKey(),
        Number.parseInt(options.user, 10),
        contents,
      );

      printJson(result);
    });

  opml
    .command("export")
    .argument("<userId>", "User ID")
    .option("-o, --output <file>", "Write output to file instead of stdout")
    .description("Export OPML for a user")
    .action(async (userId: string, options: { output?: string }) => {
      const result = await client.exportOpml(
        getApiKey(),
        Number.parseInt(userId, 10),
      );

      if (options.output !== undefined) {
        await writeTextFileEnsuringParent(options.output, result.opml);
        printJson({
          ok: true,
          output: options.output,
          user_id: result.user_id,
        });
        return;
      }

      process.stdout.write(result.opml);
      if (!result.opml.endsWith("\n")) {
        process.stdout.write("\n");
      }
    });
}
