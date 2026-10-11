import type { League, Player } from "../db/schema.js";
import { leagueUrl } from "../services/braacket.js";

/** The status line shared by /rank and /expose. */
export function overallRankLine(player: Player, totalPlayers: number): string {
  // A stored player with no rank is "Not available" on the service (no results),
  // so they have no current ranking — i.e. inactive.
  if (player.rank === undefined) {
    return `${playerLink(player)} is currently inactive.`;
  }
  const tail = player.active ? "." : " overall, but is currently inactive.";
  return `${playerLink(player)} is rank ${player.rank} of ${totalPlayers}${tail}`;
}

/**
 * A player's name as a masked link to their braacket page (falls back to inline
 * code if we somehow have no URL). The `reply` helper suppresses the link-preview
 * embed these would otherwise generate.
 */
export function playerLink(player: Player): string {
  if (!player.url) return `\`${player.name}\``;
  return `[${escapeLinkText(player.name)}](${player.url})`;
}

/**
 * A league id as a masked link to its braacket page, or just inline code when
 * the league isn't a configured braacket league.
 */
export function leagueLink(leagueId: string, league: League): string {
  if (league.service !== "braacket" || !league.serviceId) {
    return `\`${leagueId}\``;
  }
  return `[${escapeLinkText(leagueId)}](${leagueUrl(league.serviceId)})`;
}

/** Escape `[`/`]` so a name with brackets can't break `[text](url)` syntax. */
function escapeLinkText(text: string): string {
  return text.replace(/[[\]]/g, "\\$&");
}
