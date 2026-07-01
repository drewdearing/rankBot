import type { League, Player } from "../db/schema.js";
import {
  finishLeagueRefresh,
  getAllPlayers,
  removeAllPlayers,
  removePlayer,
  setLeagueAggregates,
  upsertPlayer,
} from "../db/repo.js";
import { mapWithConcurrency } from "../util/concurrency.js";
import { log } from "../util/logger.js";
import {
  fetchPlayerDetail,
  fetchRankingState,
  fetchRoster,
  type PlayerDetail,
  type RankingState,
  type RosterEntry,
} from "./braacket.js";

// Kept modest to be polite during a large (~thousands of pages) refresh; the
// scraper's retry/backoff handles any throttling on top of this.
const CONCURRENCY = 4;
// Hard-bounds the WHOLE run (ranking + roster + detail fetches) via an
// AbortSignal, so even in-flight requests are cancelled at the deadline and the
// final editReply always lands inside Discord's 15-minute interaction-token
// window. 12 min leaves ~3 min of margin for the reply (and role application on
// a completing run).
const RUN_BUDGET_MS = 12 * 60 * 1000;

export type UpdateResult =
  | { status: "uptodate" }
  // `failed` = roster rows we attempted but whose detail fetch threw. They keep
  // their old (or no) version stamp, so they stay pending and a re-run retries
  // them; report it so the caller can prompt for that re-run.
  | { status: "complete"; ranked: number; fetched: number; failed: number }
  // `remaining` = rows the budget cut off before we attempted them; `failed` =
  // rows we attempted within budget but whose fetch threw. Both need a re-run.
  | { status: "partial"; fetched: number; remaining: number; failed: number }
  // The ranking recomputed mid-scrape, so the pass may blend two computations —
  // not committed; re-run for a clean snapshot.
  | { status: "superseded"; fetched: number };

/** The braacket + repo calls runLeagueUpdate makes — injectable for testing. */
export interface UpdateDeps {
  fetchRankingState: (
    serviceId: string,
    signal?: AbortSignal,
  ) => Promise<RankingState>;
  fetchRoster: (
    serviceId: string,
    signal?: AbortSignal,
  ) => Promise<{ entries: RosterEntry[]; total: number }>;
  fetchPlayerDetail: (
    url: string,
    signal?: AbortSignal,
  ) => Promise<PlayerDetail>;
  getAllPlayers: (leagueId: string) => Promise<Player[]>;
  upsertPlayer: (leagueId: string, player: Player) => Promise<void>;
  removePlayer: (leagueId: string, playerId: string) => Promise<void>;
  removeAllPlayers: (leagueId: string) => Promise<void>;
  finishLeagueRefresh: (
    leagueId: string,
    signature: string,
    maxPoints: number,
    totalPlayers: number,
  ) => Promise<void>;
  setLeagueAggregates: (
    leagueId: string,
    maxPoints: number,
    totalPlayers: number,
  ) => Promise<void>;
}

const defaultDeps: UpdateDeps = {
  fetchRankingState,
  fetchRoster,
  fetchPlayerDetail,
  getAllPlayers,
  upsertPlayer,
  removePlayer,
  removeAllPlayers,
  finishLeagueRefresh,
  setLeagueAggregates,
};

/**
 * Refresh a league's players from the ranking service.
 *
 * Every run fetches the roster and reconciles it against the stored players: a
 * player is re-scraped when it's missing from the DB or its stamped version
 * (`rankingId|lastUpdated`) is behind the live ranking. So a row that went
 * missing is always healed — we never declare "up to date" purely because the
 * league signature matches.
 *   - When nothing is missing or stale, the run is `uptodate` after only the
 *     roster check (no per-player scraping).
 *   - A run cut short by the time budget resumes by refetching only the players
 *     not yet at the live version.
 *   - If the ranking recomputes mid-resume, every player's version no longer
 *     matches, so they all refetch — the stored snapshot never mixes two
 *     computations.
 *
 * After a full pass, the version is re-checked: a recompute that happened *during*
 * the scrape yields `superseded` (nothing committed) rather than a blended
 * snapshot. `force` first wipes the stored players, so the whole roster flows
 * back through the same missing-row path — a fresh rebuild that resumes the same
 * way if the budget cuts it short (just run `/league update` again, no force).
 */
export async function runLeagueUpdate(
  leagueId: string,
  league: League,
  opts: { force?: boolean; budgetMs?: number; signal?: AbortSignal } = {},
  deps: UpdateDeps = defaultDeps,
): Promise<UpdateResult> {
  // Start the clock before any network I/O: the budget must cover the ranking
  // and roster fetches too (both slow through a proxy), not just the detail loop,
  // or a run can outlast Discord's interaction token before we get to reply.
  const budgetMs = opts.budgetMs ?? RUN_BUDGET_MS;
  const deadline = Date.now() + budgetMs;
  // Hard deadline: fires an abort that cancels any in-flight fetch, so the run
  // unwinds and replies at the deadline instead of drifting past it while slow
  // proxied requests finish their retries. (AbortSignal.timeout self-cleans — no
  // controller/timer to clear.) Combined with an optional external signal
  // (graceful shutdown) so a deploy landing mid-scrape also unwinds and replies.
  const timeoutSignal = AbortSignal.timeout(Math.max(0, budgetMs));
  const signal = opts.signal
    ? AbortSignal.any([timeoutSignal, opts.signal])
    : timeoutSignal;
  const { serviceId } = league;
  const { rankingId, lastUpdated } = await deps.fetchRankingState(serviceId, signal);
  const version = `${rankingId}|${lastUpdated}`;

  // Always verify the stored rows against the live roster — never trust the
  // league signature alone to declare "up to date". A row can go missing (or
  // fall stale) without the ranking version changing, so we fetch the roster on
  // every run and refetch only the players that are absent or behind.
  // The listing total is braacket's "X out of N" denominator; reused as the roster.
  const { entries: roster, total: rosterTotal } = await deps.fetchRoster(
    serviceId,
    signal,
  );
  // Excluded players have no ranking data — never store or fetch them.
  const fetchable = roster.filter((entry) => !entry.excluded);
  const keepIds = new Set(fetchable.map((entry) => entry.id));

  // `force` nukes the cache so a possibly-wrong snapshot is rebuilt from
  // scratch; the wiped rows then look "missing" and flow through the normal
  // refetch path (resumable if the rebuild outlasts the budget). The roster
  // fetch above runs first, so we never wipe when braacket is unreachable.
  if (opts.force) await deps.removeAllPlayers(leagueId);

  const existing = new Map(
    (await deps.getAllPlayers(leagueId)).map((player) => [player.id, player] as const),
  );

  // Drop stored players who left the roster or were excluded.
  for (const id of existing.keys()) {
    if (!keepIds.has(id)) await deps.removePlayer(leagueId, id);
  }

  // A player needs refetching when the version is untrusted (no timestamp
  // parsed), when its row is missing entirely, or when its stamp is behind the
  // live version.
  const trustCache = lastUpdated !== "";
  const pending = fetchable.filter((entry) => {
    if (!trustCache) return true;
    const current = existing.get(entry.id);
    // Refetch when the row is missing, its version is behind, or its stored URL
    // no longer matches the roster — a changed braacket UUID (same name) means
    // the cached detail belongs to a stale player record.
    return (
      current === undefined ||
      current.rankingVersion !== version ||
      current.url !== entry.url
    );
  });

  // Every roster row is present and current — the cache already matches the
  // live ranking, so there's nothing to re-scrape.
  if (pending.length === 0) {
    const current = [...existing.values()].filter((p) => keepIds.has(p.id));
    const maxPoints = current.reduce((max, p) => Math.max(max, p.points ?? 0), 0);
    await deps.setLeagueAggregates(leagueId, maxPoints, rosterTotal);
    return { status: "uptodate" };
  }

  let attempted = 0;
  let fetched = 0;

  await mapWithConcurrency(pending, CONCURRENCY, async (entry) => {
    // Deadline or shutdown — stop starting work and leave it for the next run
    // (an already-aborted signal yields a clean `partial`, not a re-check error).
    if (signal.aborted || Date.now() > deadline) return;
    attempted += 1;
    try {
      const detail = await deps.fetchPlayerDetail(entry.url, signal);
      // Store every player — including "Not available" ones — stamped with the
      // version, so they leave `pending` and don't get re-fetched every resume.
      // (Not-available docs carry no points/rank; toPlayer handles that.)
      await deps.upsertPlayer(leagueId, toPlayer(entry, detail, version));
      fetched += 1;
    } catch (err) {
      // A deadline abort is expected shutdown, not a real failure — don't warn.
      if (!signal.aborted) log.warn(`detail fetch failed for ${entry.id}:`, err);
    }
  });

  const players = await deps.getAllPlayers(leagueId);
  const maxPoints = players.reduce((max, p) => Math.max(max, p.points ?? 0), 0);

  if (attempted >= pending.length) {
    // Full pass done — but only commit if the ranking didn't recompute while we
    // were scraping, otherwise the snapshot could blend two computations.
    const after = await deps.fetchRankingState(serviceId, signal);
    if (`${after.rankingId}|${after.lastUpdated}` === version) {
      await deps.finishLeagueRefresh(leagueId, version, maxPoints, rosterTotal);
      const ranked = players.filter((p) => p.rank !== undefined).length;
      return { status: "complete", ranked, fetched, failed: attempted - fetched };
    }
    await deps.setLeagueAggregates(leagueId, maxPoints, rosterTotal);
    return { status: "superseded", fetched };
  }
  await deps.setLeagueAggregates(leagueId, maxPoints, rosterTotal);
  return {
    status: "partial",
    fetched,
    remaining: pending.length - attempted,
    failed: attempted - fetched,
  };
}

function toPlayer(
  entry: RosterEntry,
  detail: PlayerDetail,
  version: string,
): Player {
  const player: Player = {
    id: entry.id,
    name: entry.name,
    url: entry.url,
    active: detail.available ? detail.active : false,
    rankingVersion: version,
  };
  if (detail.available) {
    if (detail.points !== undefined) player.points = detail.points;
    if (detail.rank !== undefined) player.rank = detail.rank;
  }
  return player;
}
