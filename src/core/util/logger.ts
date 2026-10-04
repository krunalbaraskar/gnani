export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

export const consoleLogger: Logger = {
  info: (m, meta) => console.info(`[bolo] ${m}`, meta ?? ''),
  warn: (m, meta) => console.warn(`[bolo] ${m}`, meta ?? ''),
  error: (m, meta) => console.error(`[bolo] ${m}`, meta ?? ''),
};
