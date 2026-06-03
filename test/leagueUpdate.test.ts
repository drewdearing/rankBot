import { describe, expect, it } from "vitest";
import type { League, Player } from "../src/db/schema.ts";
import type {
  PlayerDetail,
  RankingState,
  RosterEntry,
} from "../src/services/braacket.ts";
import { runLeagueUpdate, type UpdateDeps } from "../src/services/leagueUpdate.ts";

// ---------------------------------------------------------------------------
// Fixtures + a fake-backed harness
// ---------------------------------------------------------------------------

function makeLeague(over: Partial<League> = {}): League {
  return {
    owner: "owner",
    mods: [],
    private: false,
    service: "braacket",
    serviceId: "svc",
    ranks: [],
    maxPoints: 0,
    totalPlayers: 0,
    ...over,
  };
}

function entry(id: string, opts: { excluded?: boolean } = {}): RosterEntry {
  return { id, name: id, url: `https://x/${id}`, excluded: opts.excluded ?? false };
}

function ranked(rank: number, points: number, active = true): PlayerDetail {
  return { available: true, rank, points, active };
}
const notAvailable: PlayerDetail = { available: false };

function storedPlayer(id: string, version: string): Player {
  return { id, name: id, url: `https://x/${id}`, active: true, rankingVersion: version };
}

interface HarnessOpts {
  /** A single state, or a sequence returned on successive fetchRankingState calls. */
  state: RankingState | RankingState[];
  roster: RosterEntry[];
  rosterTotal?: number;
  details?: Record<string, PlayerDetail>;
  initial?: Player[];
}

function harness(o: HarnessOpts) {
  const players = new Map<string, Player>((o.initial ?? []).map((p) => [p.id, p]));
  const states = Array.isArray(o.state) ? o.state : null;
  let stateCalls = 0;

  const detailFetches: string[] = [];
  const removed: string[] = [];
  const upserted: Player[] = [];
  const finished: Array<{ signature: string; maxPoints: number; totalPlayers: number }> = [];
  const aggregates: Array<{ maxPoints: number; totalPlayers: number }> = [];
  let rosterFetched = 0;

  const deps: UpdateDeps = {
    fetchRankingState: async () => {
      const i = stateCalls++;
      return states ? states[Math.min(i, states.length - 1)]! : (o.state as RankingState);
    },
    fetchRoster: async () => {
      rosterFetched += 1;
      return { entries: o.roster, total: o.rosterTotal ?? o.roster.length };
    },
    fetchPlayerDetail: async (url) => {
      detailFetches.push(url);
      const id = url.split("/").pop() ?? "";
      return o.details?.[id] ?? notAvailable;
    },
    getAllPlayers: async () => [...players.values()],
    upsertPlayer: async (_l, p) => {
      players.set(p.id, p);
      upserted.push(p);
    },
    removePlayer: async (_l, id) => {
      players.delete(id);
      removed.push(id);
    },
    finishLeagueRefresh: async (_l, signature, maxPoints, totalPlayers) => {
      finished.push({ signature, maxPoints, totalPlayers });
    },
    setLeagueAggregates: async (_l, maxPoints, totalPlayers) => {
      aggregates.push({ maxPoints, totalPlayers });
    },
  };

  return {
    deps,
    players,
    detailFetches,
    removed,
    upserted,
    finished,
    aggregates,
    rosterFetched: () => rosterFetched,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const V2: RankingState = { rankingId: "rk", lastUpdated: "t2" };

describe("runLeagueUpdate", () => {
  it("skips (uptodate) when the live version matches the stored signature", async () => {
    const h = harness({ state: V2, roster: [entry("a")] });
    const result = await runLeagueUpdate(
      "lg",
      makeLeague({ rankingSignature: "rk|t2" }),
      {},
      h.deps,
    );
    expect(result).toEqual({ status: "uptodate" });
    expect(h.rosterFetched()).toBe(0); // never even fetched the roster
    expect(h.detailFetches).toEqual([]);
    expect(h.finished).toEqual([]);
  });

  it("full-scrapes and commits the version when it changed", async () => {
    const h = harness({
      state: V2,
      roster: [entry("a"), entry("b")],
      rosterTotal: 50,
      details: { a: ranked(1, 100), b: ranked(2, 80) },
    });
    const result = await runLeagueUpdate(
      "lg",
      makeLeague({ rankingSignature: "rk|OLD" }),
      {},
      h.deps,
    );
    expect(result).toEqual({ status: "complete", ranked: 2, fetched: 2 });
    expect(h.detailFetches.sort()).toEqual(["https://x/a", "https://x/b"]);
    expect(h.upserted.every((p) => p.rankingVersion === "rk|t2")).toBe(true);
    // totalPlayers is the roster (listing) total, maxPoints from stored players.
    expect(h.finished).toEqual([
      { signature: "rk|t2", maxPoints: 100, totalPlayers: 50 },
    ]);
  });

  it("resumes — refetches only players not already at the live version", async () => {
    const h = harness({
      state: V2,
      roster: [entry("a"), entry("b"), entry("c")],
      details: { b: ranked(2, 80), c: ranked(3, 70) },
      initial: [storedPlayer("a", "rk|t2")], // already current
    });
    const result = await runLeagueUpdate(
      "lg",
      makeLeague({ rankingSignature: "rk|OLD" }),
      {},
      h.deps,
    );
    expect(result.status).toBe("complete");
    expect(h.detailFetches.sort()).toEqual(["https://x/b", "https://x/c"]); // a skipped
  });

  it("does not commit when the ranking recomputes mid-scrape (superseded)", async () => {
    const h = harness({
      state: [V2, { rankingId: "rk", lastUpdated: "t3" }], // changes by the end check
      roster: [entry("a")],
      details: { a: ranked(1, 100) },
    });
    const result = await runLeagueUpdate(
      "lg",
      makeLeague({ rankingSignature: "rk|OLD" }),
      {},
      h.deps,
    );
    expect(result).toEqual({ status: "superseded", fetched: 1 });
    expect(h.finished).toEqual([]); // signature NOT committed
    expect(h.aggregates).toHaveLength(1);
  });

  it("removes excluded/departed players but stores (stamps) 'Not available' ones", async () => {
    const h = harness({
      state: V2,
      roster: [
        entry("keep"),
        entry("banned", { excluded: true }),
        entry("noresults"),
      ],
      details: { keep: ranked(1, 100), noresults: notAvailable },
      initial: [
        storedPlayer("left", "rk|t1"), // not on roster anymore → removed
        storedPlayer("banned", "rk|t1"), // now excluded → removed
      ],
    });
    const result = await runLeagueUpdate(
      "lg",
      makeLeague({ rankingSignature: "rk|OLD" }),
      {},
      h.deps,
    );
    expect(result.status).toBe("complete");
    expect(h.detailFetches).not.toContain("https://x/banned"); // excluded never fetched
    expect(h.removed.sort()).toEqual(["banned", "left"]);
    // "Not available" is kept (stamped) so it isn't re-fetched on the next resume.
    expect([...h.players.keys()].sort()).toEqual(["keep", "noresults"]);
    const noresults = h.players.get("noresults");
    expect(noresults?.active).toBe(false);
    expect(noresults?.rank).toBeUndefined();
    expect(noresults?.rankingVersion).toBe("rk|t2");
  });

  it("force re-scrapes everyone even when the version already matches", async () => {
    const h = harness({
      state: V2,
      roster: [entry("a")],
      details: { a: ranked(1, 100) },
      initial: [storedPlayer("a", "rk|t2")], // current — would normally be skipped
    });
    const result = await runLeagueUpdate(
      "lg",
      makeLeague({ rankingSignature: "rk|t2" }),
      { force: true },
      h.deps,
    );
    expect(result.status).toBe("complete");
    expect(h.detailFetches).toEqual(["https://x/a"]);
  });

  it("returns partial without committing when the budget is exhausted", async () => {
    const h = harness({
      state: V2,
      roster: [entry("a"), entry("b")],
      details: { a: ranked(1, 100), b: ranked(2, 80) },
    });
    const result = await runLeagueUpdate(
      "lg",
      makeLeague({ rankingSignature: "rk|OLD" }),
      { budgetMs: -1 }, // deadline already passed → nothing fetched
      h.deps,
    );
    expect(result).toEqual({ status: "partial", fetched: 0, remaining: 2 });
    expect(h.detailFetches).toEqual([]);
    expect(h.finished).toEqual([]); // signature NOT committed on a partial run
    expect(h.aggregates).toHaveLength(1);
  });
});
