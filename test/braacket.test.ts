import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  fetchPlayerDetail,
  parsePlayerDetail,
  parsePlayerName,
  parsePlayerUrl,
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

describe("parsePlayerName", () => {
  it("reads the player name from the detail page title", () => {
    expect(parsePlayerName(fixture("braacket-detail-active.html"))).toBe("PeachyKeen");
  });

  it("keeps a '/' that is part of the name (splits on the full marker)", () => {
    const html = "<title>Austin Melee / Player / she/eeesh | manko</title>";
    expect(parsePlayerName(html)).toBe("she/eeesh | manko");
  });

  it("returns undefined when the title isn't a player page", () => {
    expect(parsePlayerName("<title>Austin Melee / Ranking</title>")).toBeUndefined();
  });
});

describe("parsePlayerUrl", () => {
  it("extracts the uuid from a pasted braacket profile link", () => {
    expect(
      parsePlayerUrl(
        "https://braacket.com/league/ResurrectedUltimate/player/AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
      ),
    ).toBe("AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA");
  });

  it("returns null for a plain name", () => {
    expect(parsePlayerUrl("PeachyKeen")).toBeNull();
  });

  it("returns null for a non-braacket url (never fetch arbitrary hosts)", () => {
    expect(
      parsePlayerUrl("https://evil.example.com/player/AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA"),
    ).toBeNull();
  });
});

describe("getHtml abort", () => {
  it("aborts immediately (no fetch) when the signal is already aborted", async () => {
    // An already-aborted signal trips getHtml's pre-fetch guard, so this makes no
    // network call — it proves a deadline abort is terminal, not a retried flake.
    await expect(
      fetchPlayerDetail(
        "https://braacket.com/league/x/player/AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
        AbortSignal.abort(),
      ),
    ).rejects.toThrow(/aborted/i);
  });
});
