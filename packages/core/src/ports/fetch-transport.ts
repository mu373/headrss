export interface TransportOptions {
  headers: Record<string, string>;
  timeout: number;
  maxRedirects: number;
}

export interface TransportResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  finalUrl: string;
}

export interface FetchTransport {
  fetch(url: string, options: TransportOptions): Promise<TransportResult>;
}
