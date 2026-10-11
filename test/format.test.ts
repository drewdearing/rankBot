import { describe, expect, it } from "vitest";
import type { League, Player } from "../src/db/schema.ts";
import { leagueLink, overallRankLine, playerLink } from "../src/discord/format.ts";

function player(over: Partial<Player>): Player {
  return { id: "x", name: "X", url: "u", active: true, ...over };
}

function league(over: Partial<League> = {}): League {
  return {
    owner: "o",
    mods: [],
    private: false,
    service: "braacket",
    serviceId: "MyLeague",
    ranks: [],
    maxPoints: 0,
    totalPlayers: 0,
    ...over,
  };
}

describe("overallRankLine", () => {
  it("active ranked player links the name", () => {
    expect(
      overallRankLine(
        player({ name: "Ann", url: "https://braacket.com/league/x/player/A", rank: 3, active: true }),
        50,
      ),
    ).toBe("[Ann](https://braacket.com/league/x/player/A) is rank 3 of 50.");
  });

  it("inactive-but-ranked player keeps the rank", () => {
    expect(
      overallRankLine(player({ name: "Bob", url: "u", rank: 16, active: false }), 1375),
    ).toBe("[Bob](u) is rank 16 of 1375 overall, but is currently inactive.");
  });

  it("'Not available' player (no rank) reads as inactive", () => {
    expect(overallRankLine(player({ name: "Cee", url: "u", active: false }), 1375)).toBe(
      "[Cee](u) is currently inactive.",
    );
  });
});

describe("playerLink", () => {
  it("masks the name to the braacket url", () => {
    expect(playerLink(player({ name: "Ann", url: "u" }))).toBe("[Ann](u)");
  });

  it("escapes brackets in the name", () => {
    expect(playerLink(player({ name: "a[b]c", url: "u" }))).toBe("[a\\[b\\]c](u)");
  });

  it("falls back to inline code when there is no url", () => {
    expect(playerLink(player({ name: "Ann", url: "" }))).toBe("`Ann`");
  });
});

describe("leagueLink", () => {
  it("masks the league id to its braacket page", () => {
    expect(leagueLink("my-league", league({ serviceId: "MyLeague" }))).toBe(
      "[my-league](https://braacket.com/league/MyLeague)",
    );
  });

  it("falls back to inline code for a non-braacket league", () => {
    expect(leagueLink("my-league", league({ service: "", serviceId: "" }))).toBe(
      "`my-league`",
    );
  });
});
