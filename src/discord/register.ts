import { REST, Routes } from "discord.js";
import { config } from "../config.js";
import { log } from "../util/logger.js";
import { commands } from "./commands/index.js";

/**
 * Registers slash commands with Discord. Run via `npm run register`.
 * When DEV_GUILD_ID is set, commands register to that guild instantly;
 * otherwise they register globally (can take up to ~1 hour to propagate).
 */
async function main(): Promise<void> {
  const body = commands.map((command) => command.data.toJSON());
  const rest = new REST({ version: "10" }).setToken(config.botToken);

  if (config.devGuildId) {
    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.devGuildId),
      { body },
    );
    log.info(`Registered ${body.length} command(s) to guild ${config.devGuildId}.`);
  } else {
    await rest.put(Routes.applicationCommands(config.clientId), { body });
    log.info(`Registered ${body.length} command(s) globally.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error("Failed to register commands:", err);
    process.exit(1);
  });
