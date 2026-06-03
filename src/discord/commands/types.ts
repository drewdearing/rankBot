import type {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

/**
 * Optional metadata consumed by `/help`. The slash-command builder is the source
 * of truth for names/descriptions/options; this only carries what the builder
 * can't express — which audience a command is for and any longer-form prose.
 */
export interface CommandHelp {
  /** Which group the command appears under in the `/help` overview. */
  audience: "everyone" | "mod";
  /** A fuller one-liner than the 100-char slash-command description allows. */
  summary?: string;
  /** Concrete invocations to show in the per-command detail view. */
  examples?: string[];
}

export interface Command {
  data:
    | SlashCommandBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | SlashCommandOptionsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  help?: CommandHelp;
}
