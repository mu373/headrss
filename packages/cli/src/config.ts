export type LogLevel = "debug" | "info" | "warn" | "error";

const DEFAULT_FETCH_CONCURRENCY = 8;
const DEFAULT_FETCH_INTERVAL_SECONDS = 900;
const DEFAULT_FETCH_TIMEOUT_SECONDS = 30;
const DEFAULT_LOG_LEVEL: LogLevel = "info";
const DEFAULT_RETENTION_DAYS = 90;

export function getHeadrssUrl(): string {
  const raw = requireEnv("HEADRSS_URL");
  return raw.replace(/\/+$/, "");
}

export function getEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

export function requireEnv(name: string): string {
  const value = getEnv(name);

  if (value === undefined) {
    throw new Error(`Missing required environment variable ${name}.`);
  }

  return value;
}

export function getFetchConcurrency(): number {
  return getPositiveInteger("FETCH_CONCURRENCY", DEFAULT_FETCH_CONCURRENCY);
}

export function getFetchIntervalSeconds(): number {
  return getPositiveInteger("FETCH_INTERVAL", DEFAULT_FETCH_INTERVAL_SECONDS);
}

export function getFetchTimeoutMs(): number {
  return getPositiveInteger("FETCH_TIMEOUT", DEFAULT_FETCH_TIMEOUT_SECONDS) * 1000;
}

export function getRetentionDays(): number {
  return getPositiveInteger("RETENTION_DAYS", DEFAULT_RETENTION_DAYS);
}

export function getLogLevel(): LogLevel {
  const level = getEnv("LOG_LEVEL");

  if (level === undefined) {
    return DEFAULT_LOG_LEVEL;
  }

  if (level === "debug" || level === "info" || level === "warn" || level === "error") {
    return level;
  }

  throw new Error(
    `Invalid LOG_LEVEL value "${level}". Expected one of: debug, info, warn, error.`,
  );
}

function getPositiveInteger(name: string, fallback: number): number {
  const raw = getEnv(name);

  if (raw === undefined) {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${name} value "${raw}". Expected a positive integer.`);
  }

  return value;
}
