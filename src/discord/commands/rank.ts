import { SlashCommandBuilder } from "discord.js";
import {
  getGuildLeagueId,
  getLeague,
  getMemberTag,
  getPlayer,
} from "../../db/repo.js";
import { playerKey } from "../../util/playerKey.js";
import { overallRankLine } from "../format.js";
import { updateMemberRole } from "../roles.js";
import type { Command } from "./types.js";
import { reply, requireGuildContext } from "./util.js";

export const rankCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("rank")
    .setDescription("See ranking info or refresh your role.")
    .addSubcommand((s) =>
      s
        .setName("view")
        .setDescription("Show a player's rank.")
        .addStringOption((o) =>
          o
            .setName("player")
            .setDescription("Player name (defaults to your tag)")
            .setRequired(false),
        ),
    )
    .addSubcommand((s) =>
      s.setName("update").setDescription("Refresh your rank role."),
    ),

  async execute(interaction) {
    const ctx = await requireGuildContext(interaction);
    if (!ctx) return;

    const leagueId = await getGuildLeagueId(ctx.guild.id);
    if (!leagueId) {
      await reply(
        interaction,
        "your server is not initialized with a league!\n\nUse `/league set` to get started!",
        true,
      );
      return;
    }
    const league = await getLeague(leagueId);
    if (!league) {
      await reply(
        interaction,
        "the league associated with this server cannot be found.",
        true,
      );
      return;
    }

    if (interaction.options.getSubcommand() === "update") {
      await updateMemberRole(ctx.guild, leagueId, league, interaction.user.id);
      await reply(interaction, "rank updated!", true);
      return;
    }

    let name = interaction.options.getString("player")?.trim();
    if (!name) {
      const tag = await getMemberTag(ctx.guild.id, interaction.user.id);
      if (!tag) {
        await reply(
          interaction,
          "your tag is not currently set!\n\nUse `/tag set` to associate your account with your player name!",
          true,
        );
        return;
      }
      name = tag; // the tag stores the raw player name
    }

    // The tag/name is a raw display name; the player doc id is its key.
    const player = await getPlayer(leagueId, playerKey(name));
    if (!player) {
      await reply(interaction, `player \`${name}\` is not recognized.`, true);
      return;
    }

    await reply(interaction, overallRankLine(player, league.totalPlayers));
  },
};
