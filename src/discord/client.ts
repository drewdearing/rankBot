import { Client, GatewayIntentBits } from "discord.js";

/**
 * The Discord client. We only need guild metadata and member data (for role
 * assignment) — slash commands mean we never read message content, so no
 * privileged MessageContent intent is required. GuildMembers IS privileged and
 * must be enabled in the Developer Portal.
 */
export function createClient(): Client {
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });
}
