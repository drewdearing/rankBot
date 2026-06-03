import { db, type League, type Player, type Rank } from "./schema.js";

/**
 * Data-access helpers over the Typesaurus schema. Collections use plain string
 * ids (Discord ids, league ids, lowercased player names), so reads/writes take
 * raw strings.
 */

// ---------------------------------------------------------------------------
// Guild ↔ league association
// ---------------------------------------------------------------------------

export async function getGuildLeagueId(guildId: string): Promise<string | null> {
  const guild = await db.guilds.get(guildId);
  return guild?.data.leagueId ?? null;
}

export async function setGuildLeague(
  guildId: string,
  leagueId: string,
): Promise<void> {
  await db.guilds.set(guildId, { leagueId });
}

// ---------------------------------------------------------------------------
// Leagues
// ---------------------------------------------------------------------------

export async function getLeague(leagueId: string): Promise<League | null> {
  const league = await db.leagues.get(leagueId);
  return league?.data ?? null;
}

export async function createLeague(
  leagueId: string,
  owner: string,
): Promise<void> {
  await db.leagues.set(leagueId, {
    owner,
    mods: [],
    private: false,
    service: "",
    serviceId: "",
    ranks: [],
    maxPoints: 0,
    totalPlayers: 0,
  });
}

export async function setLeagueService(
  leagueId: string,
  service: string,
  serviceId: string,
): Promise<void> {
  await db.leagues.update(leagueId, { service, serviceId });
}

export async function setLeagueMods(
  leagueId: string,
  mods: string[],
): Promise<void> {
  await db.leagues.update(leagueId, { mods });
}

export async function setLeagueRanks(
  leagueId: string,
  ranks: Rank[],
): Promise<void> {
  await db.leagues.update(leagueId, { ranks });
}

export async function deleteLeague(leagueId: string): Promise<void> {
  await deleteAllPlayers(leagueId);
  await db.leagues.remove(leagueId);
}

// ---------------------------------------------------------------------------
// Players (subcollection of a league)
// ---------------------------------------------------------------------------

export async function getPlayer(
  leagueId: string,
  playerId: string,
): Promise<Player | null> {
  const player = await db.leagues(leagueId).players.get(playerId);
  return player?.data ?? null;
}

export async function getAllPlayers(leagueId: string): Promise<Player[]> {
  const docs = await db.leagues(leagueId).players.all();
  return docs.map((doc) => doc.data);
}

export async function upsertPlayer(
  leagueId: string,
  player: Player,
): Promise<void> {
  await db.leagues(leagueId).players.set(player.id, player);
}

export async function removePlayer(
  leagueId: string,
  playerId: string,
): Promise<void> {
  await db.leagues(leagueId).players.remove(playerId);
}

export async function setLeagueAggregates(
  leagueId: string,
  maxPoints: number,
  totalPlayers: number,
): Promise<void> {
  await db.leagues.update(leagueId, { maxPoints, totalPlayers });
}

/** Mark the refresh complete: persist the version we fully scraped + aggregates. */
export async function finishLeagueRefresh(
  leagueId: string,
  rankingSignature: string,
  maxPoints: number,
  totalPlayers: number,
): Promise<void> {
  await db.leagues.update(leagueId, {
    rankingSignature,
    maxPoints,
    totalPlayers,
  });
}

async function deleteAllPlayers(leagueId: string): Promise<void> {
  const existing = await db.leagues(leagueId).players.all();
  await Promise.all(
    existing.map((doc) => db.leagues(leagueId).players.remove(doc.ref.id)),
  );
}

// ---------------------------------------------------------------------------
// Members / tag claims (subcollection of a guild)
// ---------------------------------------------------------------------------

export interface MemberTag {
  userId: string;
  tag: string;
}

export async function getMemberTag(
  guildId: string,
  userId: string,
): Promise<string | null> {
  const member = await db.guilds(guildId).members.get(userId);
  return member?.data.tag ?? null;
}

export async function getAllMemberTags(guildId: string): Promise<MemberTag[]> {
  const docs = await db.guilds(guildId).members.all();
  return docs.map((doc) => ({ userId: doc.ref.id, tag: doc.data.tag }));
}

export async function setMemberTag(
  guildId: string,
  userId: string,
  tag: string,
): Promise<void> {
  await db.guilds(guildId).members.set(userId, { tag: tag.toLowerCase() });
}

export async function removeMemberTag(
  guildId: string,
  userId: string,
): Promise<void> {
  await db.guilds(guildId).members.remove(userId);
}

export async function isTagTaken(
  guildId: string,
  tag: string,
  exceptUserId: string,
): Promise<boolean> {
  const lower = tag.toLowerCase();
  const tags = await getAllMemberTags(guildId);
  return tags.some((m) => m.userId !== exceptUserId && m.tag === lower);
}

export async function findUsersByTag(
  guildId: string,
  tag: string,
): Promise<string[]> {
  const lower = tag.toLowerCase();
  const tags = await getAllMemberTags(guildId);
  return tags.filter((m) => m.tag === lower).map((m) => m.userId);
}
