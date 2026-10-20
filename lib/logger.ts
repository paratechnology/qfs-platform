/* Minimal structured logger — console only, no heavy deps. */

function fmt(level: string, msg: string, meta?: unknown) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
  if (meta === undefined) return line;
  return `${line} ${JSON.stringify(meta)}`;
}

export const logger = {
  info: (msg: string, meta?: unknown) => console.log(fmt("info", msg, meta)),
  warn: (msg: string, meta?: unknown) => console.warn(fmt("warn", msg, meta)),
  error: (msg: string, meta?: unknown) => console.error(fmt("error", msg, meta)),
};