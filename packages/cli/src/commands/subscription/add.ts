import type { Command } from "commander";
import type { HeadrssApiClient, NativeLabel } from "../../api-client.js";
import { withNativeToken } from "../../auth.js";
import { printJson } from "../../utils.js";

export function registerSubscriptionAddCommand(
  parent: Command,
  client: HeadrssApiClient,
): void {
  parent
    .command("add")
    .argument("<url>", "Feed URL")
    .option("--title <title>", "Custom title")
    .option("--folder <folder>", "Folder ID or name")
    .description("Subscribe to a feed")
    .action(
      async (url: string, options: { folder?: string; title?: string }) => {
        const subscription = await withNativeToken(client, async (token) => {
          const folder =
            options.folder === undefined
              ? undefined
              : await resolveFolderId(client, token, options.folder);

          return client.addSubscription(token, {
            ...(folder !== undefined ? { folder } : {}),
            ...(options.title !== undefined ? { title: options.title } : {}),
            url,
          });
        });

        printJson(subscription);
      },
    );
}

async function resolveFolderId(
  client: HeadrssApiClient,
  token: string,
  rawValue: string,
): Promise<number> {
  if (/^\d+$/.test(rawValue)) {
    return Number.parseInt(rawValue, 10);
  }

  const folders = await client.listFolders(token);
  const existing = folders.items.find((folder) => folder.name === rawValue);

  if (existing !== undefined) {
    return existing.id;
  }

  const created = await client.addFolder(token, rawValue);
  return created.id;
}

export function findFolderByName(
  folders: NativeLabel[],
  name: string,
): NativeLabel | undefined {
  return folders.find((folder) => folder.name === name);
}
