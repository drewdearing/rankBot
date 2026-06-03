import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
} from "discord.js";

/** Reply to an interaction, transparently handling the deferred case. */
export async function reply(
  interaction: ChatInputCommandInteraction,
  content: string,
  ephemeral = false,
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content });
    return;
  }
  await interaction.reply(
    ephemeral ? { content, flags: MessageFlags.Ephemeral } : { content },
  );
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
