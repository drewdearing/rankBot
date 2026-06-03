import { schema, type Typesaurus } from "typesaurus";

/**
 * Firestore data model (typed with Typesaurus).
 *
 * Per-document model — players and members are individual documents in
 * subcollections rather than packed into a single map document, so we never
 * hit Firestore's 1 MB-per-document limit.
 *
 *   guilds/{guildId}                     -> { leagueId }
 *   guilds/{guildId}/members/{userId}    -> { tag }                (per-guild claims)
 *   leagues/{leagueId}                   -> { owner, mods, ... }
 *   leagues/{leagueId}/players/{playerId} -> { id, name, points... }
 */

/** A Discord guild's association to a league. */
export interface Guild {
  leagueId: string;
}

/** A Discord member's claimed player tag within a guild. */
export interface Member {
  /** Lowercased player tag the member claimed. */
  tag: string;
}

/** A role-assignment rule for a league. */
export interface Rank {
  /** Lowercased Discord role name to assign. */
  role: string;
  /** Fraction of the league's max points required (0–1+). */
  percentile: number;
  /** Whether the player must be active on the service to qualify. */
  activeRequired: boolean;
}

/** A league of ranked players, optionally shared across guilds. */
export interface League {
  /** Discord user id of the league owner. */
  owner: string;
  /** Discord user ids with mod permissions. */
  mods: string[];
  private: boolean;
  /** Ranking service, e.g. "braacket". */
  service: string;
  /** The league's id on the ranking service. */
  serviceId: string;
  ranks: Rank[];
  /** Highest point total across players (derived on update). */
  maxPoints: number;
  /** Player count (derived on update). */
  totalPlayers: number;
  /**
   * The ranking version (`rankingId|lastUpdated`) of the last *complete* refresh.
   * If it equals the live version on the next update, every player is already at
   * that version, so we skip the (expensive) per-player re-scrape entirely.
   */
  rankingSignature?: string;
}

/** A ranked player pulled from the ranking service. */
export interface Player {
  /** Lowercased name, used as the document id. */
  id: string;
  name: string;
  points?: number;
  rank?: number;
  active: boolean;
  /** Service profile URL used to scrape detail. */
  url: string;
  /**
   * The ranking version (`rankingId|lastUpdated`) this player's data was scraped
   * under. The player is current iff this equals the league's live version —
   * which drives resumable, version-consistent refreshes (no wall-clock).
   */
  rankingVersion?: string;
}

export const db = schema(($) => ({
  guilds: $.collection<Guild, string>().sub({
    members: $.collection<Member, string>(),
  }),
  leagues: $.collection<League, string>().sub({
    players: $.collection<Player, string>(),
  }),
}));

export type Schema = Typesaurus.Schema<typeof db>;
