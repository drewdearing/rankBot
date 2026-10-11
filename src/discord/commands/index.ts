import { exposeCommand } from "./expose.js";
import { buildHelpCommand } from "./help.js";
import { leagueCommand } from "./league.js";
import { rankCommand } from "./rank.js";
import { tagCommand } from "./tag.js";
import type { Command } from "./types.js";

// The user-facing commands `/help` describes. Kept separate so the help command
// is built from them (and isn't listed as a command about itself).
const baseCommands: Command[] = [
  tagCommand,
  leagueCommand,
  rankCommand,
  exposeCommand,
];

export const commands: Command[] = [...baseCommands, buildHelpCommand(baseCommands)];

export const commandsByName = new Map<string, Command>(
  commands.map((command) => [command.data.name, command]),
);

export type { Command } from "./types.js";
