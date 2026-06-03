import {
  ApplicationCommandOptionType,
  SlashCommandBuilder,
  type APIApplicationCommandBasicOption,
  type APIApplicationCommandOption,
  type APIApplicationCommandSubcommandGroupOption,
  type APIApplicationCommandSubcommandOption,
} from "discord.js";
import type { Command } from "./types.js";
import { reply } from "./util.js";

/**
 * `/help` — a self-describing overview plus per-command detail. Everything is
 * derived from the command registry (names, descriptions, subcommands, and the
 * optional `help` metadata), so it can't drift out of sync with the real
 * commands. Built via a factory so the registry can be injected, avoiding a
 * circular import with `index.ts` and a hand-maintained list of choices.
 */
export function buildHelpCommand(commands: readonly Command[]): Command {
  const byName = new Map(commands.map((c) => [c.data.name, c]));

  const data = new SlashCommandBuilder()
    .setName("help")
    .setDescription("How to use rankBot, or details on a command.")
    .addStringOption((o) =>
      o
        .setName("command")
        .setDescription("Show details for one command")
        .setRequired(false)
        .addChoices(
          ...commands.map((c) => ({ name: c.data.name, value: c.data.name })),
        ),
    );

  return {
    data,
    async execute(interaction) {
      const wanted = interaction.options.getString("command");
      const target = wanted ? byName.get(wanted) : undefined;
      const content = target ? commandDetail(target) : overview(commands);
      await reply(interaction, content, true);
    },
  };
}

/** The top-level overview: getting-started steps + commands grouped by audience. */
function overview(commands: readonly Command[]): string {
  const line = (c: Command): string =>
    `\`/${c.data.name}\` — ${c.help?.summary ?? c.data.description}`;
  const inGroup = (audience: "everyone" | "mod"): Command[] =>
    commands.filter((c) => (c.help?.audience ?? "everyone") === audience);

  return [
    "**rankBot** scrapes braacket power rankings into Discord and assigns roles by percentile.",
    "",
    "**Getting started**",
    "1. A mod links a league: `/league set <id>`, then `/league service braacket <id>`.",
    "2. Pull rankings with `/league update`, then define roles with `/league ranks add`.",
    "3. Players claim their name with `/tag set <player>`, then check `/rank view`.",
    "",
    "**For everyone**",
    ...inGroup("everyone").map(line),
    "",
    "**For mods / league managers**",
    ...inGroup("mod").map(line),
    "",
    "_Use_ `/help command:<name>` _for a command's subcommands and options._",
  ].join("\n");
}

/** Detail for one command: its subcommands (or options) and any examples. */
function commandDetail(command: Command): string {
  const json = command.data.toJSON();
  const options = json.options ?? [];
  const lines = [`**/${json.name}** — ${command.help?.summary ?? json.description}`];

  const groups = options.filter(isGroup);
  const subcommands = options.filter(isSubcommand);

  if (groups.length === 0 && subcommands.length === 0) {
    // A flat command (e.g. /expose): show its own options on one usage line.
    const leaves = options.filter(isLeaf);
    lines.push(`\`${usage(json.name, leaves)}\``);
  } else {
    lines.push("");
    for (const sub of subcommands) lines.push(subcommandLine(json.name, null, sub));
    for (const group of groups) {
      for (const sub of group.options ?? []) {
        lines.push(subcommandLine(json.name, group.name, sub));
      }
    }
  }

  if (command.help?.examples?.length) {
    lines.push("", "**Examples**", ...command.help.examples.map((e) => `\`${e}\``));
  }
  return lines.join("\n");
}

/** `/league set <league_id>` — Link or create a league by id. */
function subcommandLine(
  commandName: string,
  groupName: string | null,
  sub: APIApplicationCommandSubcommandOption,
): string {
  const path = groupName ? `${commandName} ${groupName} ${sub.name}` : `${commandName} ${sub.name}`;
  return `\`${usage(path, sub.options ?? [])}\` — ${sub.description}`;
}

/** `/path <required> [optional]` from a leaf option list. */
function usage(path: string, options: readonly APIApplicationCommandBasicOption[]): string {
  const tokens = options.map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`));
  return tokens.length > 0 ? `/${path} ${tokens.join(" ")}` : `/${path}`;
}

function isSubcommand(
  o: APIApplicationCommandOption,
): o is APIApplicationCommandSubcommandOption {
  return o.type === ApplicationCommandOptionType.Subcommand;
}

function isGroup(
  o: APIApplicationCommandOption,
): o is APIApplicationCommandSubcommandGroupOption {
  return o.type === ApplicationCommandOptionType.SubcommandGroup;
}

function isLeaf(o: APIApplicationCommandOption): o is APIApplicationCommandBasicOption {
  return !isSubcommand(o) && !isGroup(o);
}
