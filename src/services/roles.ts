import type { Rank } from "../db/schema.js";

/** The minimum a player needs for role resolution. */
export interface RankablePlayer {
  active: boolean;
  points?: number;
}

/**
 * Resolve the single role a player should hold, given a league's rank rules.
 *
 * Ranks are stored sorted ascending by threshold, so we walk them in order and
 * keep the last (highest) rule the player qualifies for. A rule with
 * `activeRequired` only applies to active players. Returns the lowercased role
 * name, or null if the player qualifies for none.
 *
 * Extracted from the duplicated logic in the original `newTagRole` /
 * `updateRoles` functions so it can be reused and unit-tested.
 */
export function resolveRoleForPlayer(
  player: RankablePlayer,
  ranks: Rank[],
  maxPoints: number,
): string | null {
  const points = player.points ?? 0;
  let role: string | null = null;

  for (const rank of ranks) {
    const meetsActivity = !rank.activeRequired || player.active;
    const meetsPoints = points >= rank.percentile * maxPoints;
    if (meetsActivity && meetsPoints) {
      role = rank.role;
    }
  }

  return role;
}
