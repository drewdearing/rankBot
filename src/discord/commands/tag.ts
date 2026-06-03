import { SlashCommandBuilder } from "discord.js";
import {
  findUsersByTag,
  getGuildLeagueId,
  getLeague,
  getMemberTag,
  isTagTaken,
  removeMemberTag,
  setMemberTag,
} from "../../db/repo.js";
import { hasModPermission } from "../permissions.js";
import { updateMemberRole } from "../roles.js";
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
          o.setName("player").setDescription("Player name").setRequired(true),
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
      if (await isTagTaken(guild.id, input, userId)) {
        await reply(
          interaction,
          `tag \`${input}\` is already linked to another account!\n\nUse \`/tag unlink\` to unlink your tag.`,
          true,
        );
        return;
      }
      await setMemberTag(guild.id, userId, input);
      await reply(interaction, "tag set!", true);
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
