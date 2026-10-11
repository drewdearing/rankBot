import { describe, expect, it } from "vitest";
import { playerKey } from "../src/util/playerKey.ts";

describe("playerKey", () => {
  it("lowercases the name", () => {
    expect(playerKey("PeachyKeen")).toBe("peachykeen");
  });

  it("percent-escapes forward slashes (illegal in a Firestore document id)", () => {
    expect(playerKey("she/eeesh | manko")).toBe("she%2feeesh | manko");
    expect(playerKey("a/b/c")).toBe("a%2fb%2fc");
  });

  it("is injective — a '/' name and a '-' name never collide", () => {
    expect(playerKey("a/b")).toBe("a%2fb");
    expect(playerKey("a-b")).toBe("a-b");
    expect(playerKey("a/b")).not.toBe(playerKey("a-b"));
  });

  it("escapes the escape char so encoding stays injective", () => {
    // "a/b" -> "a%2fb"; a literal "a%2fb" must NOT collide with it.
    expect(playerKey("a/b")).toBe("a%2fb");
    expect(playerKey("a%2fb")).toBe("a%252fb");
    expect(playerKey("a/b")).not.toBe(playerKey("a%2fb"));
  });

  it("never yields a slash and avoids the reserved whole-string forms", () => {
    for (const name of [".", "..", "__x__", "", "a/b/c"]) {
      const key = playerKey(name);
      expect(key).not.toContain("/");
      expect(key.length).toBeGreaterThan(0);
    }
    expect(playerKey(".")).not.toBe(".");
    expect(playerKey("__proto__")).not.toMatch(/^__.*__$/);
  });
});
