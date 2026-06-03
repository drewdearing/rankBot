import { exposeCommand } from "./expose.js";
import { leagueCommand } from "./league.js";
import { rankCommand } from "./rank.js";
import { tagCommand } from "./tag.js";
import type { Command } from "./types.js";

export const commands: Command[] = [
  tagCommand,
  leagueCommand,
  rankCommand,
  exposeCommand,
];

export const commandsByName = new Map<string, Command>(
  commands.map((command) => [command.data.name, command]),
);

export type { Command } from "./types.js";
