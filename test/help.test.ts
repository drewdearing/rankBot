import { SlashCommandBuilder } from "discord.js";
import { describe, expect, it } from "vitest";
import { buildHelpCommand } from "../src/discord/commands/help.ts";
import type { Command } from "../src/discord/commands/types.ts";

// A flat command (options, no subcommands) — like /expose.
const flat: Command = {
  data: new SlashCommandBuilder()
    .setName("expose")
    .setDescription("Roast a player.")
    .addStringOption((o) =>
      o.setName("player").setDescription("Player").setRequired(false),
    ),
  help: {
    audience: "everyone",
    summary: "Roast a player (or yourself).",
    examples: ["/expose", "/expose Mango"],
  },
  async execute() {},
};

// Subcommands + a subcommand group with a required option — like /league.
const grouped: Command = {
  data: new SlashCommandBuilder()
    .setName("league")
    .setDescription("Manage this server's league.")
    .addSubcommand((s) =>
      s
        .setName("set")
        .setDescription("Link a league.")
        .addStringOption((o) =>
          o.setName("league_id").setDescription("id").setRequired(true),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName("mod")
        .setDescription("Manage mods.")
        .addSubcommand((s) =>
          s
            .setName("add")
            .setDescription("Add a mod.")
            .addUserOption((o) =>
              o.setName("member").setDescription("Member").setRequired(true),
            ),
        ),
    ),
  help: { audience: "mod", summary: "Configure the league." },
  async execute() {},
};

const help = buildHelpCommand([flat, grouped]);

/** Invoke /help with the given `command` arg and capture the replied content. */
async function run(command: string | null): Promise<string> {
  let captured = "";
  const interaction = {
    deferred: false,
    replied: false,
    options: { getString: (name: string) => (name === "command" ? command : null) },
    reply: async (payload: { content: string }) => {
      captured = payload.content;
    },
  } as unknown as Parameters<Command["execute"]>[0];
  await help.execute(interaction);
  return captured;
}

describe("buildHelpCommand", () => {
  it("offers a choice for each command, in order", () => {
    const json = help.data.toJSON();
    const opt = json.options?.find((o) => o.name === "command");
    const values =
      opt && "choices" in opt ? (opt.choices ?? []).map((c) => c.value) : [];
    expect(values).toEqual(["expose", "league"]);
  });

  it("groups commands by audience in the overview", async () => {
    const text = await run(null);
    expect(text).toContain("**Getting started**");
    expect(text).toContain("**For everyone**");
    expect(text).toContain("`/expose` — Roast a player (or yourself).");
    expect(text).toContain("**For mods / league managers**");
    expect(text).toContain("`/league` — Configure the league.");
  });

  it("shows a flat command's optional option and examples", async () => {
    const text = await run("expose");
    expect(text).toContain("`/expose [player]`");
    expect(text).toContain("/expose Mango");
  });

  it("renders subcommands and groups with required-option tokens", async () => {
    const text = await run("league");
    expect(text).toContain("`/league set <league_id>` — Link a league.");
    expect(text).toContain("`/league mod add <member>` — Add a mod.");
  });

  it("falls back to the overview for an unknown command", async () => {
    expect(await run("nope")).toContain("**Getting started**");
  });
});
