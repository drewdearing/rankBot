import { describe, expect, it } from "vitest";
import { resolveRoleForPlayer } from "../src/services/roles.ts";
import type { Rank } from "../src/db/schema.ts";

// Sorted ascending by threshold, as the league command stores them.
const ranks: Rank[] = [
  { role: "bronze", percentile: 0.25, activeRequired: false },
  { role: "silver", percentile: 0.5, activeRequired: false },
  { role: "gold", percentile: 0.75, activeRequired: true },
];

const maxPoints = 1000;

describe("resolveRoleForPlayer", () => {
  it("returns null when there are no ranks", () => {
    expect(resolveRoleForPlayer({ active: true, points: 900 }, [], maxPoints)).toBeNull();
  });

  it("returns null when the player meets no threshold", () => {
    expect(resolveRoleForPlayer({ active: true, points: 100 }, ranks, maxPoints)).toBeNull();
  });

  it("picks the highest threshold the player qualifies for", () => {
    expect(resolveRoleForPlayer({ active: true, points: 600 }, ranks, maxPoints)).toBe("silver");
  });

  it("awards an active-required role to active players", () => {
    expect(resolveRoleForPlayer({ active: true, points: 800 }, ranks, maxPoints)).toBe("gold");
  });

  it("skips an active-required role for inactive players, falling back to a lower one", () => {
    expect(resolveRoleForPlayer({ active: false, points: 800 }, ranks, maxPoints)).toBe("silver");
  });

  it("treats missing points as zero", () => {
    expect(resolveRoleForPlayer({ active: true }, ranks, maxPoints)).toBeNull();
  });

  it("matches exactly at the threshold boundary", () => {
    expect(resolveRoleForPlayer({ active: true, points: 250 }, ranks, maxPoints)).toBe("bronze");
  });
});
