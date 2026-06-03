import type { Guild } from "discord.js";
import type { League, Player } from "../db/schema.js";
import { getAllMemberTags, getAllPlayers, getMemberTag, getPlayer } from "../db/repo.js";
import { resolveRoleForPlayer } from "../services/roles.js";
import { log } from "../util/logger.js";

/** Recompute and apply the rank role for a single guild member. */
export async function updateMemberRole(
  guild: Guild,
  leagueId: string,
  league: League,
  userId: string,
): Promise<void> {
  const tag = await getMemberTag(guild.id, userId);
  const player = tag ? await getPlayer(leagueId, tag) : null;
  await reconcile(guild, league, userId, player);
}

/** Recompute and apply rank roles for every member who has claimed a tag. */
export async function updateAllMemberRoles(
  guild: Guild,
  leagueId: string,
  league: League,
): Promise<void> {
  const members = await getAllMemberTags(guild.id);
  if (members.length === 0) return;

  const players = new Map(
    (await getAllPlayers(leagueId)).map((p) => [p.id, p] as const),
  );
  await guild.members.fetch().catch(() => undefined);

  for (const { userId, tag } of members) {
    await reconcile(guild, league, userId, players.get(tag) ?? null);
  }
}

/**
 * Bring a member's rank roles in line with the league rules: ensure they hold
 * exactly the one role they qualify for (if any) and none of the others.
 */
async function reconcile(
  guild: Guild,
  league: League,
  userId: string,
  player: Player | null,
): Promise<void> {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;

  const target = resolveRoleForPlayer(
    player ?? { active: false, points: 0 },
    league.ranks,
    league.maxPoints,
  );
  const rankRoleNames = new Set(league.ranks.map((r) => r.role.toLowerCase()));

  try {
    const stale = member.roles.cache.filter(
      (role) =>
        rankRoleNames.has(role.name.toLowerCase()) &&
        role.name.toLowerCase() !== target,
    );
    if (stale.size > 0) {
      await member.roles.remove([...stale.keys()]);
    }

    if (target) {
      const role = guild.roles.cache.find(
        (r) => r.name.toLowerCase() === target,
      );
      if (role && !member.roles.cache.has(role.id)) {
        await member.roles.add(role);
      }
    }
  } catch (err) {
    log.warn(`failed to update roles for ${userId} in ${guild.id}:`, err);
  }
}
