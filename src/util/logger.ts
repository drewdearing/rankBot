/** Minimal timestamped logger used across the bot. */
function stamp(): string {
  return new Date().toISOString();
}

export const log = {
  info: (...args: unknown[]): void => console.log(stamp(), "INFO", ...args),
  warn: (...args: unknown[]): void => console.warn(stamp(), "WARN", ...args),
  error: (...args: unknown[]): void => console.error(stamp(), "ERROR", ...args),
};
