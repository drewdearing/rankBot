import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
} from "discord.js";

/** A masked link — `[text](http…)` — that Discord would expand into a preview. */
const MASKED_LINK = /\]\(https?:\/\//;

/** Reply to an interaction, transparently handling the deferred case. */
export async function reply(
  interaction: ChatInputCommandInteraction,
  content: string,
  ephemeral = false,
): Promise<void> {
  // Masked links trigger a large link-preview embed; suppress it so our short
  // status lines stay compact. Bare URLs (e.g. the socktastic clip) have no
  // masked-link syntax, so they're left to embed normally.
  const suppress = MASKED_LINK.test(content);

  if (interaction.deferred || interaction.replied) {
    // Ephemerality is fixed at defer time; only SuppressEmbeds is editable here.
    await interaction.editReply(
      suppress ? { content, flags: MessageFlags.SuppressEmbeds } : { content },
    );
    return;
  }

  const flags =
    (ephemeral ? MessageFlags.Ephemeral : 0) |
    (suppress ? MessageFlags.SuppressEmbeds : 0);
  await interaction.reply(flags ? { content, flags } : { content });
}

export interface GuildContext {
  guild: Guild;
  member: GuildMember;
}

/** Ensure the command runs in a guild and resolve the caller's full member. */
export async function requireGuildContext(
  interaction: ChatInputCommandInteraction,
): Promise<GuildContext | null> {
  const { guild } = interaction;
  if (!guild) {
    await reply(interaction, "please use this command in a server!", true);
    return null;
  }
  const member = await guild.members.fetch(interaction.user.id);
  return { guild, member };
}
