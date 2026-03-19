import { getLogLevel, type LogLevel } from "./config.js";

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export function createLogger(level = getLogLevel()): Logger {
  const currentLevel = LOG_LEVEL_ORDER[level];

  const log = (targetLevel: LogLevel, message: string, meta?: unknown): void => {
    if (LOG_LEVEL_ORDER[targetLevel] < currentLevel) {
      return;
    }

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] ${targetLevel.toUpperCase()}`;
    const suffix = meta === undefined ? "" : ` ${formatMeta(meta)}`;
    process.stderr.write(`${prefix} ${message}${suffix}\n`);
  };

  return {
    debug(message, meta) {
      log("debug", message, meta);
    },
    info(message, meta) {
      log("info", message, meta);
    },
    warn(message, meta) {
      log("warn", message, meta);
    },
    error(message, meta) {
      log("error", message, meta);
    },
  };
}

function formatMeta(meta: unknown): string {
  if (meta instanceof Error) {
    return meta.message;
  }

  if (typeof meta === "string") {
    return meta;
  }

  return JSON.stringify(meta);
}
