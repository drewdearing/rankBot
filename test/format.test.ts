import { describe, expect, it } from "vitest";
import type { Player } from "../src/db/schema.ts";
import { overallRankLine } from "../src/discord/format.ts";

function player(over: Partial<Player>): Player {
  return { id: "x", name: "X", url: "u", active: true, ...over };
}

describe("overallRankLine", () => {
  it("active ranked player", () => {
    expect(
      overallRankLine(player({ name: "Ann", rank: 3, points: 90, active: true }), 50),
    ).toBe("`Ann` is rank 3 of 50.");
  });

  it("inactive-but-ranked player keeps the rank", () => {
    expect(
      overallRankLine(player({ name: "Bob", rank: 16, points: 1560, active: false }), 1375),
    ).toBe("`Bob` is rank 16 of 1375 overall, but is currently inactive.");
  });

  it("'Not available' player (no rank) reads as inactive", () => {
    expect(overallRankLine(player({ name: "Cee", active: false }), 1375)).toBe(
      "`Cee` is currently inactive.",
    );
  });
});
