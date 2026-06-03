import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parsePlayerDetail,
  parseRankingState,
  parseRoster,
} from "../src/services/braacket.ts";
import { playerKey } from "../src/util/playerKey.ts";

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
    "utf8",
  );
}

describe("parseRoster", () => {
  const { entries, total } = parseRoster(
    fixture("braacket-listing.html"),
    "ResurrectedUltimate",
  );

  it("reads the total from the footer", () => {
    expect(total).toBe(106);
  });

  it("parses one entry per roster member", () => {
    expect(entries).toHaveLength(106);
  });

  it("keys the id (Firestore-safe), keeps the name, and builds a detail url with the uuid", () => {
    for (const entry of entries) {
      expect(entry.id).toBe(playerKey(entry.name));
      expect(entry.url).toMatch(
        /^https:\/\/braacket\.com\/league\/ResurrectedUltimate\/player\/[0-9A-Fa-f-]{36}$/,
      );
      expect(typeof entry.excluded).toBe("boolean");
    }
  });

  it("flags excluded players from the fa-ban icon", () => {
    const html = `<table class='table my-table-checkbox'><tbody>
      <tr><td class='ellipsis'><a href='/league/x/player/AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA'>Ranked Guy</a></td></tr>
      <tr><td class='ellipsis'><a href='/league/x/player/BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB'>Banned Guy</a>
        <span title='Excluded' class='text-muted'><i class='fa fa-ban fa-fw'></i></span></td></tr>
    </tbody></table>`;
    const { entries: parsed } = parseRoster(html, "x");
    expect(parsed.find((e) => e.name === "Ranked Guy")?.excluded).toBe(false);
    expect(parsed.find((e) => e.name === "Banned Guy")?.excluded).toBe(true);
  });
});

describe("parseRankingState", () => {
  const state = parseRankingState(fixture("braacket-ranking.html"));

  it("reads the active ranking's id", () => {
    expect(state.rankingId).toBe("50083FF6-601B-4054-B67B-C0817A7466A2");
  });

  it("reads the last-computed timestamp from the status tooltip (ignoring the label)", () => {
    expect(state.lastUpdated).toBe("03 June 2026 04:16");
  });
});

describe("parsePlayerDetail", () => {
  it("parses an active ranked player", () => {
    const detail = parsePlayerDetail(fixture("braacket-detail-active.html"));
    expect(detail).toEqual({
      available: true,
      rank: 1,
      points: 1994,
      active: true,
    });
  });

  it("parses a ranked-but-inactive player (danger span in the activity box)", () => {
    const detail = parsePlayerDetail(fixture("braacket-detail-inactive.html"));
    expect(detail).toEqual({
      available: true,
      rank: 16,
      points: 1560,
      active: false,
    });
  });

  it("reports a 'Not available' player as unavailable", () => {
    const detail = parsePlayerDetail(
      fixture("braacket-detail-notavailable.html"),
    );
    expect(detail).toEqual({ available: false });
  });
});
