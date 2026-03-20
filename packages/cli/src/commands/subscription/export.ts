import type { Command } from "commander";

import { withNativeToken } from "../../auth.js";
import type { HeadrssApiClient } from "../../api-client.js";
import { printJson, writeTextFileEnsuringParent } from "../../utils.js";

export function registerSubscriptionExportCommand(
  parent: Command,
  client: HeadrssApiClient,
): void {
  parent
    .command("export")
    .option("-o, --output <file>", "Write output to file")
    .description("Export subscriptions as OPML")
    .action(async (options: { output?: string }) => {
      const opml = await withNativeToken(client, async (token) => client.exportOpmlNative(token));

      if (options.output !== undefined) {
        await writeTextFileEnsuringParent(options.output, opml);
        printJson({ ok: true, output: options.output });
        return;
      }

      process.stdout.write(opml);
      if (!opml.endsWith("\n")) {
        process.stdout.write("\n");
      }
    });
}
