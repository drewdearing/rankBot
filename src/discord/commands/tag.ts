import { MessageFlags, SlashCommandBuilder } from "discord.js";
import {
  findUsersByTag,
  getAllPlayers,
  getGuildLeagueId,
  getLeague,
  getMemberTag,
  getPlayer,
  isTagTaken,
  removeMemberTag,
  setMemberTag,
} from "../../db/repo.js";
import type { League } from "../../db/schema.js";
import {
  fetchPlayerByName,
  fetchPlayerName,
  parsePlayerUrl,
  playerUrl,
  playerUuidFromUrl,
} from "../../services/braacket.js";
import { hasModPermission } from "../permissions.js";
import { updateMemberRole } from "../roles.js";
import { log } from "../../util/logger.js";
import { playerKey } from "../../util/playerKey.js";
import type { Command } from "./types.js";
import { reply, requireGuildContext } from "./util.js";

export const tagCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("tag")
    .setDescription("Link your Discord account to a player name.")
    .addSubcommand((s) =>
      s.setName("view").setDescription("Show your currently linked tag."),
    )
    .addSubcommand((s) =>
      s
        .setName("set")
        .setDescription("Claim a player name.")
        .addStringOption((o) =>
          o
            .setName("player")
            .setDescription("Player name or braacket profile link")
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("unlink")
        .setDescription("Unlink your tag, or (mods) a player's tag.")
        .addStringOption((o) =>
          o
            .setName("player")
            .setDescription("Mods: player name to unlink from everyone")
            .setRequired(false),
        ),
    ),

  async execute(interaction) {
    const ctx = await requireGuildContext(interaction);
    if (!ctx) return;
    const { guild, member } = ctx;
    const userId = interaction.user.id;

    const leagueId = await getGuildLeagueId(guild.id);
    if (!leagueId) {
      await reply(
        interaction,
        "your server is not initialized with a league!\n\nUse `/league set` to get started!",
        true,
      );
      return;
    }
    const league = await getLeague(leagueId);

    const sub = interaction.options.getSubcommand();

    if (sub === "view") {
      const tag = await getMemberTag(guild.id, userId);
      await reply(
        interaction,
        tag
          ? `your tag is currently set to \`${tag}\`.`
          : "your tag is not currently set!\n\nUse `/tag set` to associate your account with your player name!",
        true,
      );
      return;
    }

    if (sub === "set") {
      const input = interaction.options.getString("player", true).trim();
      // Resolving may hit braacket (?search= / detail fetch), which can exceed
      // the ~3s initial-response window — defer first, then edit the reply.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const resolved = await resolveTagName(leagueId, league, input);
      if ("error" in resolved) {
        await reply(interaction, resolved.error, true);
        return;
      }
      const name = resolved.name;
      if (await isTagTaken(guild.id, name, userId)) {
        await reply(
          interaction,
          `tag \`${name}\` is already linked to another account!\n\nUse \`/tag unlink\` to unlink your tag.`,
          true,
        );
        return;
      }
      await setMemberTag(guild.id, userId, name);
      await reply(interaction, `tag set to \`${name}\`!`, true);
      if (league) await updateMemberRole(guild, leagueId, league, userId);
      return;
    }

    // sub === "unlink"
    const target = interaction.options.getString("player")?.trim();
    if (target) {
      if (!hasModPermission(member)) {
        await reply(
          interaction,
          "you do not have permission to use this command!",
          true,
        );
        return;
      }
      const users = await findUsersByTag(guild.id, target);
      await Promise.all(users.map((u) => removeMemberTag(guild.id, u)));
      await reply(interaction, "tag unlinked!", true);
      if (league) {
        await Promise.all(
          users.map((u) => updateMemberRole(guild, leagueId, league, u)),
        );
      }
      return;
    }

    await removeMemberTag(guild.id, userId);
    await reply(interaction, "tag unlinked!", true);
    if (league) await updateMemberRole(guild, leagueId, league, userId);
  },
};

type TagResolution = { name: string } | { error: string };

/**
 * Resolve a `/tag set` input to a real player's name, verifying they exist:
 *   - a braacket profile link  -> uuid -> cached player, else fetched detail
 *   - a plain name             -> cached player, else braacket `?search=` lookup
 * The canonical name is returned (so the stored tag matches the roster). If the
 * league has no braacket service to check against, an uncached name is accepted
 * as-is (nothing to validate against yet).
 */
async function resolveTagName(
  leagueId: string,
  league: League | null,
  input: string,
): Promise<TagResolution> {
  const braacket =
    league?.service === "braacket" && league.serviceId ? league.serviceId : null;
  // Without a ranking service there's nothing to validate against — and the tag
  // would be inert anyway (no players, no roles) — so block it until one is set.
  if (!braacket) {
    return {
      error:
        "this server's league isn't linked to a ranking service yet — ask an admin to set one with `/league service` first.",
    };
  }

  const uuid = parsePlayerUrl(input);
  if (uuid) {
    const players = await getAllPlayers(leagueId);
    const cached = players.find((p) => playerUuidFromUrl(p.url) === uuid);
    if (cached) return { name: cached.name };
    try {
      const name = await fetchPlayerName(playerUrl(braacket, uuid));
      if (name) return { name };
    } catch (err) {
      log.warn(`tag link resolve failed for ${uuid}:`, err);
    }
    return { error: "couldn't find a player for that braacket link." };
  }

  // Plain name — prefer the cached player (canonical name + no network).
  const cached = await getPlayer(leagueId, playerKey(input));
  if (cached) return { name: cached.name };
  try {
    const entry = await fetchPlayerByName(braacket, input);
    if (entry) return { name: entry.name };
  } catch (err) {
    log.warn(`tag name lookup failed for "${input}":`, err);
  }
  return { error: `player \`${input}\` isn't in this league.` };
}
