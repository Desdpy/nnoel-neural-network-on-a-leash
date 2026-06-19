/// <reference types="vite/client" />

// Thin wrapper around ``console`` that prefixes log lines with a module
// name and always passes through the original error object so the
// browser devtools keep the full stack trace. Centralising it here
// means we can later swap to a real logger / transport without
// touching every call site.

type Meta = Record<string, unknown> | undefined;

const isDev = import.meta.env.DEV;

function format(scope: string, level: string, msg: string, err: unknown, meta: Meta) {
  const parts: unknown[] = [`[${scope}] ${level} ${msg}`];
  if (err !== undefined) parts.push(err instanceof Error ? err : String(err));
  if (meta && Object.keys(meta).length > 0) parts.push(JSON.stringify(meta));
  return parts;
}

export function createLogger(scope: string) {
  return {
    debug(msg: string, meta?: Meta) {
      if (isDev) console.debug(...format(scope, "debug", msg, undefined, meta));
    },
    info(msg: string, meta?: Meta) {
      console.info(...format(scope, "info", msg, undefined, meta));
    },
    warn(msg: string, err?: unknown, meta?: Meta) {
      console.warn(...format(scope, "warn", msg, err, meta));
    },
    error(msg: string, err?: unknown, meta?: Meta) {
      console.error(...format(scope, "error", msg, err, meta));
    },
  };
}

