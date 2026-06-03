import { PermissionsBitField, type GuildMember } from "discord.js";
import type { League } from "../db/schema.js";

/**
 * Server-level mod permission: an administrator, or anyone whose highest role
 * sits above the bot's own managed role. Replaces the original check against a
 * hardcoded role literally named "rankBot" — we now use the bot's integration
 * role, so the position-based setup in the README still works without anyone
 * having to name a role a specific way.
 */
export function hasModPermission(member: GuildMember): boolean {
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return true;
  }
  const botRole = member.guild.members.me?.roles.botRole;
  return botRole != null && member.roles.highest.comparePositionTo(botRole) > 0;
}

/** Whether a user owns or mods the given league (Firestore-stored roles). */
export function isLeagueManager(userId: string, league: League): boolean {
  return userId === league.owner || league.mods.includes(userId);
}
