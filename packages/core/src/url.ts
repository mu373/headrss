export interface ExtractedCredentials {
  username: string;
  password: string;
}

export interface ExtractedFeedUrl {
  url: string;
  credentials: ExtractedCredentials | null;
}

export function extractFeedCredentials(rawUrl: string): ExtractedFeedUrl {
  const parsed = new URL(rawUrl);

  if (!parsed.username) {
    return { url: rawUrl, credentials: null };
  }

  const credentials: ExtractedCredentials = {
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
  };

  parsed.username = "";
  parsed.password = "";

  return { url: parsed.toString(), credentials };
}
