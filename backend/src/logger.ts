type LogLevel = "debug" | "info" | "warn" | "error";

type Meta = Record<string, unknown> | undefined;

function write(level: LogLevel, message: string, meta?: Meta): void {
  const payload: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message
  };

  if (meta && Object.keys(meta).length > 0) {
    payload.meta = meta;
  }

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

export const logger = {
  debug(message: string, meta?: Meta): void {
    write("debug", message, meta);
  },
  info(message: string, meta?: Meta): void {
    write("info", message, meta);
  },
  warn(message: string, meta?: Meta): void {
    write("warn", message, meta);
  },
  error(message: string, meta?: Meta): void {
    write("error", message, meta);
  }
};
