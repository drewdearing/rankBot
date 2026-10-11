/**
 * Encode a player's display name into a Firestore-safe document id. Firestore
 * forbids "/" in ids (it's the path separator) and player names routinely
 * contain it (e.g. "she/eeesh").
 *
 * We percent-escape "%" first, then "/", so the mapping is INJECTIVE: distinct
 * names always get distinct keys — in particular "a/b" -> "a%2fb" never collides
 * with a literal "a-b" or "a%2fb". The reserved whole-string forms (".", "..",
 * /__.*__/) are prefixed.
 *
 * Apply this ONLY to a raw display name — when scraping, or to user input. Never
 * feed it an existing key: it is NOT idempotent (it would double-escape the "%").
 * Stored tags/ids are already keys and must be used as-is.
 */
export function playerKey(name: string): string {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/%/g, "%25")
    .replace(/\//g, "%2f");
  if (key === "" || key === "." || key === ".." || /^__.*__$/.test(key)) {
    return `player-${key}`;
  }
  return key;
}
