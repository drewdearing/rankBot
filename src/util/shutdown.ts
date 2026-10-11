/**
 * Graceful-shutdown coordination. Heroku sends SIGTERM on a deploy / dyno cycle
 * and waits ~30s before SIGKILL, so we abort in-flight work through `signal` and
 * let tracked tasks (e.g. a `/league update` finishing its editReply) settle
 * before the process exits — a deploy landing mid-scrape reports "run again"
 * instead of leaving the interaction hanging.
 */
export interface ShutdownCoordinator {
  /** Aborts once shutdown has begun — combine into long-running work. */
  readonly signal: AbortSignal;
  /** Register an in-flight task to await during shutdown (auto-unregisters). */
  track<T>(task: Promise<T>): Promise<T>;
  /** True once shutdown has started. */
  isShuttingDown(): boolean;
  /**
   * Begin shutdown: abort in-flight work, then wait up to `graceMs` for tracked
   * tasks to settle (so their replies land) before the caller tears down.
   */
  begin(graceMs?: number): Promise<void>;
}

export function createShutdownCoordinator(): ShutdownCoordinator {
  const controller = new AbortController();
  const inflight = new Set<Promise<unknown>>();
  return {
    signal: controller.signal,
    track<T>(task: Promise<T>): Promise<T> {
      inflight.add(task);
      const done = (): boolean => inflight.delete(task);
      // Settle-only cleanup: never rejects, so tracking can't leak an unhandled
      // rejection (the caller still awaits the real task and handles it).
      void Promise.resolve(task).then(done, done);
      return task;
    },
    isShuttingDown: () => controller.signal.aborted,
    async begin(graceMs = 25_000): Promise<void> {
      // Under Heroku's ~30s SIGTERM window; leaves margin to close the gateway.
      if (!controller.signal.aborted) controller.abort();
      if (inflight.size === 0) return;
      const grace = new Promise<void>((resolve) => {
        const t = setTimeout(resolve, graceMs);
        t.unref();
      });
      await Promise.race([Promise.allSettled([...inflight]), grace]);
    },
  };
}

/** App-wide shutdown coordinator (driven by SIGTERM/SIGINT in `index.ts`). */
export const shutdownCoordinator = createShutdownCoordinator();
