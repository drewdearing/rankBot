import { MessageFlags, SlashCommandBuilder } from "discord.js";
import {
  createLeague,
  deleteLeague,
  getGuildLeagueId,
  getLeague,
  setGuildLeague,
  setLeagueMods,
  setLeagueRanks,
  setLeagueService,
} from "../../db/repo.js";
import type { League, Rank } from "../../db/schema.js";
import {
  BraacketError,
  fetchRankingState,
  LeagueNotFoundError,
} from "../../services/braacket.js";
import { runLeagueUpdate } from "../../services/leagueUpdate.js";
import { leagueLink } from "../format.js";
import { hasModPermission, isLeagueManager } from "../permissions.js";
import { updateAllMemberRoles } from "../roles.js";
import { log } from "../../util/logger.js";
import type { Command } from "./types.js";
import { reply, requireGuildContext, type GuildContext } from "./util.js";

/** Order ranks ascending by threshold, then by activity requirement. */
function compareRanks(a: Rank, b: Rank): number {
  if (a.percentile > b.percentile || (a.activeRequired && !b.activeRequired)) return 1;
  if (b.percentile > a.percentile || (b.activeRequired && !a.activeRequired)) return -1;
  return 0;
}

export const leagueCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("league")
    .setDescription("Manage this server's league.")
    .addSubcommand((s) =>
      s.setName("info").setDescription("Show the league linked to this server."),
    )
    .addSubcommand((s) =>
      s
        .setName("set")
        .setDescription("Link or create a league by id.")
        .addStringOption((o) =>
          o
            .setName("league_id")
            .setDescription("League id (no spaces)")
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("update")
        .setDescription("Pull the latest ranking data.")
        .addBooleanOption((o) =>
          o
            .setName("force")
            .setDescription("Wipe the cached players and rebuild from scratch")
            .setRequired(false),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("delete")
        .setDescription("Permanently delete this league (owner only)."),
    )
    .addSubcommand((s) =>
      s
        .setName("service")
        .setDescription("Set the ranking service and id.")
        .addStringOption((o) =>
          o
            .setName("service")
            .setDescription("Ranking service")
            .setRequired(true)
            .addChoices({ name: "braacket", value: "braacket" }),
        )
        .addStringOption((o) =>
          o
            .setName("id")
            .setDescription("The league's id on that service")
            .setRequired(true),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName("mod")
        .setDescription("Manage league mods.")
        .addSubcommand((s) =>
          s
            .setName("add")
            .setDescription("Grant a member league-mod permission.")
            .addUserOption((o) =>
              o.setName("member").setDescription("Member").setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("remove")
            .setDescription("Revoke a member's league-mod permission.")
            .addUserOption((o) =>
              o.setName("member").setDescription("Member").setRequired(true),
            ),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName("ranks")
        .setDescription("Manage role rules.")
        .addSubcommand((s) =>
          s
            .setName("add")
            .setDescription("Add a role rule.")
            .addStringOption((o) =>
              o.setName("name").setDescription("Role name").setRequired(true),
            )
            .addNumberOption((o) =>
              o
                .setName("percentile")
                .setDescription("Fraction of max points, e.g. 0.5")
                .setRequired(true),
            )
            .addBooleanOption((o) =>
              o
                .setName("active_required")
                .setDescription("Require the player to be active")
                .setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("remove")
            .setDescription("Remove a role rule (or all of them).")
            .addStringOption((o) =>
              o
                .setName("name")
                .setDescription("Role name to remove")
                .setRequired(false),
            )
            .addBooleanOption((o) =>
              o
                .setName("all")
                .setDescription("Remove every rule")
                .setRequired(false),
            ),
        )
        .addSubcommand((s) =>
          s.setName("update").setDescription("Reapply roles to all members."),
        )
        .addSubcommand((s) =>
          s.setName("list").setDescription("List the current role rules."),
        ),
    ),

  help: {
    audience: "mod",
    summary:
      "Configure this server's league — link it, pull rankings, and manage mods and role rules. Most actions require being the league owner or a mod.",
  },

  async execute(interaction) {
    const ctx = await requireGuildContext(interaction);
    if (!ctx) return;

    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    // `set` is the only action allowed before a league is associated.
    if (!group && sub === "set") {
      await handleSet(ctx, interaction);
      return;
    }

    const leagueId = await getGuildLeagueId(ctx.guild.id);
    if (!leagueId) {
      await reply(
        interaction,
        "your server is not initialized with a league!\n\nUse `/league set` to get started!",
        true,
      );
      return;
    }

    if (!group && sub === "info") {
      const linked = await getLeague(leagueId);
      const link = linked ? leagueLink(leagueId, linked) : `\`${leagueId}\``;
      await reply(interaction, `this server is associated with ${link}.`, true);
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

    const userId = interaction.user.id;

    if (group === "mod") {
      await handleMod(ctx, interaction, leagueId, league);
      return;
    }
    if (group === "ranks") {
      await handleRanks(ctx, interaction, leagueId, league);
      return;
    }

    switch (sub) {
      case "update":
        await handleUpdate(ctx, interaction, leagueId, league);
        return;
      case "delete":
        if (userId !== league.owner) {
          await reply(interaction, "you do not have permission to use this command!", true);
          return;
        }
        await deleteLeague(leagueId);
        await reply(interaction, "league deleted.", true);
        return;
      case "service":
        await handleService(interaction, leagueId, league);
        return;
    }
  },
};

async function handleSet(
  ctx: GuildContext,
  interaction: Parameters<Command["execute"]>[0],
): Promise<void> {
  if (!hasModPermission(ctx.member)) {
    await reply(interaction, "you do not have permission to use that command!", true);
    return;
  }
  const leagueId = interaction.options.getString("league_id", true).trim();
  if (/\s/.test(leagueId)) {
    await reply(interaction, "a league id cannot include spaces.", true);
    return;
  }
  await setGuildLeague(ctx.guild.id, leagueId);
  if (!(await getLeague(leagueId))) {
    await createLeague(leagueId, interaction.user.id);
  }
  await reply(interaction, "league set!", true);
}

async function handleUpdate(
  ctx: GuildContext,
  interaction: Parameters<Command["execute"]>[0],
  leagueId: string,
  league: League,
): Promise<void> {
  if (!isLeagueManager(interaction.user.id, league)) {
    await reply(interaction, "you do not have permission to use this command!", true);
    return;
  }
  if (!league.service || !league.serviceId) {
    await reply(
      interaction,
      "the league associated with this server has not been configured to retrieve data.\n\nUse `/league service <service> <id>`.",
      true,
    );
    return;
  }
  if (league.service !== "braacket") {
    await reply(interaction, `unsupported service: \`${league.service}\`.`, true);
    return;
  }

  const force = interaction.options.getBoolean("force") ?? false;
  await interaction.deferReply();
  try {
    const result = await runLeagueUpdate(leagueId, league, { force });
    if (result.status === "uptodate") {
      await interaction.editReply(
        "already up to date — no ranking changes since the last update.",
      );
    } else if (result.status === "complete") {
      // Only apply roles from a fully-scraped snapshot, never a partial one.
      const refreshed = (await getLeague(leagueId)) ?? league;
      await updateAllMemberRoles(ctx.guild, leagueId, refreshed);
      let msg = `data updated — ${result.ranked} ranked player(s).`;
      if (result.failed > 0) {
        msg +=
          ` ${result.failed} player(s) couldn't be fetched this pass — ` +
          "run `/league update` again to retry them.";
      }
      await interaction.editReply(msg);
    } else if (result.status === "superseded") {
      await interaction.editReply(
        "the ranking was recomputed while updating, so the snapshot wasn't saved — run `/league update` again for a consistent result.",
      );
    } else {
      // partial — the time budget cut the pass short, and some attempted rows
      // may also have failed. Both leave players pending for the next run.
      const pending = result.remaining + result.failed;
      let msg = `updated ${result.fetched} player(s); ~${pending} still pending`;
      msg +=
        result.failed > 0
          ? ` (${result.remaining} not yet reached after hitting the time budget, ${result.failed} failed to fetch). `
          : " (hit the time budget). ";
      msg += "Run `/league update` again to finish — roles apply once the refresh completes.";
      await interaction.editReply(msg);
    }
  } catch (err) {
    if (err instanceof LeagueNotFoundError) {
      await interaction.editReply(
        "couldn't find that league on braacket — check the id with `/league service`.",
      );
    } else {
      log.error("league update failed:", err);
      await interaction.editReply(
        err instanceof BraacketError
          ? "braacket didn't respond as expected. Try again shortly."
          : "unable to update service data.",
      );
    }
  }
}

async function handleService(
  interaction: Parameters<Command["execute"]>[0],
  leagueId: string,
  league: League,
): Promise<void> {
  if (!isLeagueManager(interaction.user.id, league)) {
    await reply(interaction, "you do not have permission to use this command!", true);
    return;
  }
  const service = interaction.options.getString("service", true);
  const id = interaction.options.getString("id", true);

  // Re-setting the exact same service+id is a no-op — skip the round trip.
  if (league.service === service && league.serviceId === id) {
    await reply(interaction, "league service set!", true);
    return;
  }

  // Only braacket is supported; verify the league actually exists there before
  // pointing at it, so a typo'd id is caught now instead of on the next update.
  if (service !== "braacket") {
    await setLeagueService(leagueId, service, id);
    await reply(interaction, "league service set!", true);
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await fetchRankingState(id); // 404 -> LeagueNotFoundError
  } catch (err) {
    if (err instanceof LeagueNotFoundError) {
      await reply(interaction, "couldn't find that league on braacket — double-check the id.");
    } else {
      log.error("league service validation failed:", err);
      await reply(
        interaction,
        err instanceof BraacketError
          ? "braacket didn't respond as expected. Try again shortly."
          : "unable to verify the league.",
      );
    }
    return;
  }

  await setLeagueService(leagueId, service, id);
  const updated: League = { ...league, service, serviceId: id };
  await reply(interaction, `league service set! ${leagueLink(leagueId, updated)}`);
}

async function handleMod(
  ctx: GuildContext,
  interaction: Parameters<Command["execute"]>[0],
  leagueId: string,
  league: League,
): Promise<void> {
  if (!isLeagueManager(interaction.user.id, league)) {
    await reply(interaction, "you do not have permission to use this command!", true);
    return;
  }
  const target = interaction.options.getUser("member", true);
  const mods = [...league.mods];

  if (interaction.options.getSubcommand() === "add") {
    if (target.id !== league.owner && !mods.includes(target.id)) {
      mods.push(target.id);
      await setLeagueMods(leagueId, mods);
    }
    await reply(interaction, "mod added!", true);
    return;
  }

  // remove
  if (target.id === league.owner) {
    await reply(interaction, "you cannot unmod the league owner!", true);
    return;
  }
  if (mods.includes(target.id)) {
    await setLeagueMods(leagueId, mods.filter((m) => m !== target.id));
  }
  await reply(interaction, "mod removed!", true);
}

async function handleRanks(
  ctx: GuildContext,
  interaction: Parameters<Command["execute"]>[0],
  leagueId: string,
  league: League,
): Promise<void> {
  const sub = interaction.options.getSubcommand();
  const userId = interaction.user.id;

  if (sub === "list") {
    if (league.ranks.length === 0) {
      await reply(
        interaction,
        `there are no ranks associated with \`${leagueId}\`.\n\nUse \`/league ranks add\` to add new ranks.`,
        true,
      );
      return;
    }
    await reply(
      interaction,
      `the current ranks are ${league.ranks.map((r) => r.role).join(", ")}.`,
      true,
    );
    return;
  }

  if (sub === "update") {
    if (!hasModPermission(ctx.member)) {
      await reply(interaction, "you do not have permission to use this command!", true);
      return;
    }
    await interaction.deferReply();
    await updateAllMemberRoles(ctx.guild, leagueId, league);
    await interaction.editReply("member ranks updated.");
    return;
  }

  // add / remove require league-manager permission
  if (!isLeagueManager(userId, league)) {
    await reply(interaction, "you do not have permission to use this command!", true);
    return;
  }

  if (sub === "add") {
    const name = interaction.options.getString("name", true).trim().toLowerCase();
    const percentile = interaction.options.getNumber("percentile", true);
    const activeRequired = interaction.options.getBoolean("active_required", true);
    if (percentile < 0) {
      await reply(interaction, "percentile must be positive.", true);
      return;
    }
    if (league.ranks.some((r) => r.role === name)) {
      await reply(
        interaction,
        "this rank already exists!\n\nUse `/league ranks remove` to remove a rank.",
        true,
      );
      return;
    }
    const ranks = [...league.ranks, { role: name, percentile, activeRequired }];
    ranks.sort(compareRanks);
    await setLeagueRanks(leagueId, ranks);
    await reply(interaction, "rank added!", true);
    return;
  }

  // remove
  if (interaction.options.getBoolean("all") ?? false) {
    await setLeagueRanks(leagueId, []);
    await reply(interaction, "all ranks removed.", true);
    return;
  }
  const name = interaction.options.getString("name")?.trim().toLowerCase();
  if (!name) {
    await reply(interaction, "please provide a rank name, or set `all: true`.", true);
    return;
  }
  await setLeagueRanks(
    leagueId,
    league.ranks.filter((r) => r.role !== name),
  );
  await reply(interaction, "rank removed.", true);
}
