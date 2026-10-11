import { describe, expect, it } from "vitest";
import { createShutdownCoordinator } from "../src/util/shutdown.ts";

describe("shutdown coordinator", () => {
  it("aborts its signal and waits for tracked work to settle", async () => {
    const s = createShutdownCoordinator();
    expect(s.isShuttingDown()).toBe(false);
    expect(s.signal.aborted).toBe(false);

    let settled = false;
    const work = new Promise<void>((resolve) => {
      setTimeout(() => {
        settled = true;
        resolve();
      }, 20);
    });
    s.track(work);

    await s.begin(1000);
    expect(s.signal.aborted).toBe(true); // abort fired (long-running work unwinds)
    expect(s.isShuttingDown()).toBe(true);
    expect(settled).toBe(true); // begin() waited for the tracked reply to land
  });

  it("resolves immediately when nothing is in flight", async () => {
    const s = createShutdownCoordinator();
    await s.begin(1000);
    expect(s.signal.aborted).toBe(true);
  });

  it("gives up after the grace window if tracked work never settles", async () => {
    const s = createShutdownCoordinator();
    s.track(new Promise<void>(() => {})); // never resolves
    await s.begin(10); // must still return via the grace race, not hang
    expect(s.signal.aborted).toBe(true);
  });
});
