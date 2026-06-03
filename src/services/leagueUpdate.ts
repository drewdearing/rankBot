import type { League, Player } from "../db/schema.js";
import {
  finishLeagueRefresh,
  getAllPlayers,
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
// Stay comfortably inside Discord's 15-minute interaction-token window.
const RUN_BUDGET_MS = 12 * 60 * 1000;

export type UpdateResult =
  | { status: "uptodate" }
  | { status: "complete"; ranked: number; fetched: number }
  | { status: "partial"; fetched: number; remaining: number }
  // The ranking recomputed mid-scrape, so the pass may blend two computations —
  // not committed; re-run for a clean snapshot.
  | { status: "superseded"; fetched: number };

/** The braacket + repo calls runLeagueUpdate makes — injectable for testing. */
export interface UpdateDeps {
  fetchRankingState: (serviceId: string) => Promise<RankingState>;
  fetchRoster: (
    serviceId: string,
  ) => Promise<{ entries: RosterEntry[]; total: number }>;
  fetchPlayerDetail: (url: string) => Promise<PlayerDetail>;
  getAllPlayers: (leagueId: string) => Promise<Player[]>;
  upsertPlayer: (leagueId: string, player: Player) => Promise<void>;
  removePlayer: (leagueId: string, playerId: string) => Promise<void>;
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
  finishLeagueRefresh,
  setLeagueAggregates,
};

/**
 * Refresh a league's players from the ranking service.
 *
 * Skip-vs-refresh is decided by the default ranking's *version*
 * (`rankingId|lastUpdated`, one cheap request). Each player doc is stamped with
 * the version it was scraped under, so:
 *   - the skip is free when the last complete refresh already covered the live
 *     version,
 *   - a run cut short by the time budget resumes by refetching only players not
 *     yet at the live version, and
 *   - if the ranking recomputes mid-resume, every player's version no longer
 *     matches, so they all refetch — the stored snapshot never mixes two
 *     computations.
 *
 * After a full pass, the version is re-checked: a recompute that happened *during*
 * the scrape yields `superseded` (nothing committed) rather than a blended
 * snapshot. `force` re-scrapes every player regardless of version.
 */
export async function runLeagueUpdate(
  leagueId: string,
  league: League,
  opts: { force?: boolean; budgetMs?: number } = {},
  deps: UpdateDeps = defaultDeps,
): Promise<UpdateResult> {
  const { serviceId } = league;
  const { rankingId, lastUpdated } = await deps.fetchRankingState(serviceId);
  const version = `${rankingId}|${lastUpdated}`;

  // Skip when the last complete refresh already covered this exact version.
  if (
    !opts.force &&
    lastUpdated !== "" &&
    version === (league.rankingSignature ?? "")
  ) {
    return { status: "uptodate" };
  }

  // The listing total is braacket's "X out of N" denominator; reused as the roster.
  const { entries: roster, total: rosterTotal } = await deps.fetchRoster(serviceId);
  // Excluded players have no ranking data — never store or fetch them.
  const fetchable = roster.filter((entry) => !entry.excluded);
  const keepIds = new Set(fetchable.map((entry) => entry.id));
  const existing = new Map(
    (await deps.getAllPlayers(leagueId)).map((player) => [player.id, player] as const),
  );

  // Drop stored players who left the roster or were excluded.
  for (const id of existing.keys()) {
    if (!keepIds.has(id)) await deps.removePlayer(leagueId, id);
  }

  // A player needs refetching unless already stamped with the live version.
  const pending = fetchable.filter(
    (entry) => opts.force || existing.get(entry.id)?.rankingVersion !== version,
  );

  const deadline = Date.now() + (opts.budgetMs ?? RUN_BUDGET_MS);
  let attempted = 0;
  let fetched = 0;

  await mapWithConcurrency(pending, CONCURRENCY, async (entry) => {
    if (Date.now() > deadline) return; // budget hit — leave for the next run
    attempted += 1;
    try {
      const detail = await deps.fetchPlayerDetail(entry.url);
      // Store every player — including "Not available" ones — stamped with the
      // version, so they leave `pending` and don't get re-fetched every resume.
      // (Not-available docs carry no points/rank; toPlayer handles that.)
      await deps.upsertPlayer(leagueId, toPlayer(entry, detail, version));
      fetched += 1;
    } catch (err) {
      log.warn(`detail fetch failed for ${entry.id}:`, err);
    }
  });

  const players = await deps.getAllPlayers(leagueId);
  const maxPoints = players.reduce((max, p) => Math.max(max, p.points ?? 0), 0);

  if (attempted >= pending.length) {
    // Full pass done — but only commit if the ranking didn't recompute while we
    // were scraping, otherwise the snapshot could blend two computations.
    const after = await deps.fetchRankingState(serviceId);
    if (`${after.rankingId}|${after.lastUpdated}` === version) {
      await deps.finishLeagueRefresh(leagueId, version, maxPoints, rosterTotal);
      const ranked = players.filter((p) => p.rank !== undefined).length;
      return { status: "complete", ranked, fetched };
    }
    await deps.setLeagueAggregates(leagueId, maxPoints, rosterTotal);
    return { status: "superseded", fetched };
  }
  await deps.setLeagueAggregates(leagueId, maxPoints, rosterTotal);
  return { status: "partial", fetched, remaining: pending.length - attempted };
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
