import { XMLParser } from "fast-xml-parser";

import type { SubscriptionView } from "./ports/entry-store.js";
import type { User } from "./types.js";

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

interface OpmlOutlineNode {
  "@_xmlUrl"?: string;
  "@_xmlurl"?: string;
  "@_htmlUrl"?: string;
  "@_htmlurl"?: string;
  "@_title"?: string;
  "@_text"?: string;
  "@_type"?: string;
  "@_category"?: string;
  "@_categories"?: string;
  outline?: OpmlOutlineNode | OpmlOutlineNode[];
}

const getOutlineAttr = (
  node: OpmlOutlineNode,
  names: readonly string[],
): string | null => {
  for (const name of names) {
    const key = `@_${name}` as keyof OpmlOutlineNode;
    const value = node[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return null;
};

export interface ImportedFeedOutline {
  url: string;
  title: string | null;
  siteUrl: string | null;
  labels: string[];
}

export interface GroupedImportFeed {
  url: string;
  title: string | null;
  siteUrl: string | null;
  labelNames: string[];
}

export class OpmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpmlParseError";
  }
}

export function parseOpml(xml: string): ImportedFeedOutline[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) => name === "outline",
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new OpmlParseError("OPML could not be parsed.");
  }

  const opml = parsed.opml as Record<string, unknown> | undefined;
  const body = (opml?.body ?? parsed.body) as
    | { outline?: OpmlOutlineNode | OpmlOutlineNode[] }
    | undefined;

  if (body === undefined) {
    throw new OpmlParseError("OPML body element is required.");
  }

  const outlines: ImportedFeedOutline[] = [];

  const parseCategoryLabels = (node: OpmlOutlineNode): string[] => {
    const categories = getOutlineAttr(node, ["category", "categories"]);
    if (categories === null) {
      return [];
    }

    return categories
      .split(/[,/]/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  };

  const toArray = (
    value: OpmlOutlineNode | OpmlOutlineNode[] | undefined,
  ): OpmlOutlineNode[] => {
    if (value === undefined) {
      return [];
    }

    return Array.isArray(value) ? value : [value];
  };

  const walk = (nodes: OpmlOutlineNode[], labels: string[]): void => {
    for (const node of nodes) {
      const xmlUrl = getOutlineAttr(node, ["xmlUrl", "xmlurl"]);
      if (xmlUrl !== null) {
        outlines.push({
          url: xmlUrl,
          title: getOutlineAttr(node, ["title", "text"]),
          siteUrl: getOutlineAttr(node, ["htmlUrl", "htmlurl"]),
          labels: [...new Set([...labels, ...parseCategoryLabels(node)])],
        });
        continue;
      }

      const labelName = getOutlineAttr(node, ["title", "text"]);
      walk(
        toArray(node.outline),
        labelName === null ? labels : [...labels, labelName],
      );
    }
  };

  walk(toArray(body.outline), []);

  if (outlines.length === 0) {
    throw new OpmlParseError(
      "No feed outlines were found in the OPML document.",
    );
  }

  return outlines;
}

export function groupImportedFeeds(
  feeds: ImportedFeedOutline[],
): GroupedImportFeed[] {
  const grouped = new Map<string, GroupedImportFeed>();

  for (const feed of feeds) {
    const existing = grouped.get(feed.url);
    if (existing === undefined) {
      grouped.set(feed.url, {
        url: feed.url,
        title: feed.title,
        siteUrl: feed.siteUrl,
        labelNames: [...new Set(feed.labels)],
      });
      continue;
    }

    existing.title ??= feed.title;
    existing.siteUrl ??= feed.siteUrl;
    existing.labelNames = [
      ...new Set([...existing.labelNames, ...feed.labels]),
    ];
  }

  return [...grouped.values()];
}

export function buildOpml(
  user: User,
  subscriptions: SubscriptionView[],
): string {
  const folders = new Map<string, SubscriptionView[]>();
  const unfiled: SubscriptionView[] = [];

  for (const subscription of subscriptions) {
    if (subscription.labels.length === 0) {
      unfiled.push(subscription);
      continue;
    }

    for (const label of subscription.labels) {
      const entries = folders.get(label.name) ?? [];
      entries.push(subscription);
      folders.set(label.name, entries);
    }
  }

  const renderSubscription = (
    subscription: SubscriptionView,
    indent: string,
  ): string => {
    const title =
      subscription.customTitle ??
      subscription.feed.title ??
      subscription.feed.siteUrl ??
      subscription.feed.url;
    const attributes = [
      'type="rss"',
      `text="${escapeXml(title)}"`,
      `title="${escapeXml(title)}"`,
      `xmlUrl="${escapeXml(subscription.feed.url)}"`,
      ...(subscription.feed.siteUrl === null
        ? []
        : [`htmlUrl="${escapeXml(subscription.feed.siteUrl)}"`]),
    ];

    return `${indent}<outline ${attributes.join(" ")} />`;
  };

  const bodyLines: string[] = [];

  for (const [label, items] of [...folders.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    bodyLines.push(
      `    <outline text="${escapeXml(label)}" title="${escapeXml(label)}">`,
    );
    for (const subscription of items) {
      bodyLines.push(renderSubscription(subscription, "      "));
    }
    bodyLines.push("    </outline>");
  }

  for (const subscription of unfiled) {
    bodyLines.push(renderSubscription(subscription, "    "));
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    "  <head>",
    `    <title>${escapeXml(`HeadRSS subscriptions for ${user.username}`)}</title>`,
    `    <dateCreated>${escapeXml(new Date(user.createdAt * 1000).toUTCString())}</dateCreated>`,
    "  </head>",
    "  <body>",
    ...bodyLines,
    "  </body>",
    "</opml>",
  ].join("\n");
}
