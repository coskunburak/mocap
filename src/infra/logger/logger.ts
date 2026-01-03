export type LogLevel = "debug" | "info" | "warn" | "error";

type LogMeta = Record<string, unknown>;

const isDev = __DEV__;

function safeJson(meta?: LogMeta) {
  try {
    return meta ? JSON.stringify(meta) : "";
  } catch {
    return "";
  }
}

export const logger = {
  debug(msg: string, meta?: LogMeta) {
    if (!isDev) return;
    // eslint-disable-next-line no-console
    console.log(`[debug] ${msg}`, safeJson(meta));
  },
  info(msg: string, meta?: LogMeta) {
    // eslint-disable-next-line no-console
    console.log(`[info] ${msg}`, safeJson(meta));
  },
  warn(msg: string, meta?: LogMeta) {
    // eslint-disable-next-line no-console
    console.warn(`[warn] ${msg}`, safeJson(meta));
  },
  error(msg: string, meta?: LogMeta) {
    // eslint-disable-next-line no-console
    console.error(`[error] ${msg}`, safeJson(meta));
  },
};
