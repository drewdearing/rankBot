import type { Player } from "../db/schema.js";

/** The status line shared by /rank and /expose. */
export function overallRankLine(player: Player, totalPlayers: number): string {
  // A stored player with no rank is "Not available" on the service (no results),
  // so they have no current ranking — i.e. inactive.
  if (player.rank === undefined) {
    return `\`${player.name}\` is currently inactive.`;
  }
  const tail = player.active ? "." : " overall, but is currently inactive.";
  return `\`${player.name}\` is rank ${player.rank} of ${totalPlayers}${tail}`;
}
