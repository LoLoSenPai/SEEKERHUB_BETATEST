type LogContext = Record<string, unknown>;

function normalize(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: process.env.NODE_ENV === "production" ? undefined : value.stack,
    };
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

function write(level: "info" | "warn" | "error", event: string, context: LogContext = {}) {
  const entry = JSON.stringify({
    level,
    event,
    timestamp: new Date().toISOString(),
    ...Object.fromEntries(Object.entries(context).map(([key, value]) => [key, normalize(value)])),
  });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.info(entry);
}

export const logger = {
  info: (event: string, context?: LogContext) => write("info", event, context),
  warn: (event: string, context?: LogContext) => write("warn", event, context),
  error: (event: string, context?: LogContext) => write("error", event, context),
};
