import { Events, type Interaction, MessageFlags } from "discord.js";
import { config } from "./config.js";
import { initFirebase } from "./db/firebase.js";
import { createClient } from "./discord/client.js";
import { commandsByName } from "./discord/commands/index.js";
import { configureBraacketProxy } from "./services/braacket.js";
import { log } from "./util/logger.js";

configureBraacketProxy(config.braacketProxyUrl);
initFirebase();

const client = createClient();

client.once(Events.ClientReady, (readyClient) => {
  log.info(`Logged in as ${readyClient.user.tag}!${config.isDev ? " [dev]" : ""}`);
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commandsByName.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    log.error(`Error handling /${interaction.commandName}:`, err);
    const message = "something went wrong running that command.";
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: message });
      } else {
        await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
      }
    } catch {
      // The interaction may have expired; nothing more we can do.
    }
  }
});

process.on("unhandledRejection", (reason) => {
  log.error("Unhandled promise rejection:", reason);
});

// Graceful shutdown so Heroku dyno cycling (SIGTERM) closes the gateway cleanly.
const shutdown = (signal: string): void => {
  log.info(`Received ${signal}, shutting down.`);
  Promise.resolve(client.destroy())
    .catch((err) => log.error("Error during shutdown:", err))
    .finally(() => process.exit(0));
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

void client.login(config.botToken);
