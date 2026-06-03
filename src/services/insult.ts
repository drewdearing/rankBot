/**
 * Generates playful insults for the `/expose` command via the public
 * insult API, with a graceful fallback if the service is unreachable.
 */

const INSULT_API = "https://insult.mattbas.org/api/insult.json";
const SOCKTASTIC_CLIP = "https://www.youtube.com/watch?v=JOGCsnDbQUk";

function fallback(name: string): string {
  return `${name} smells... good!`;
}

/**
 * Build a playful insult for a player. `playerName` is the raw name (drives the
 * socktastic easter egg); `display` is what's shown in the insult text — pass a
 * masked link to make the name clickable. The insult API only substitutes the
 * `<adjective>` tag and echoes the rest of the template verbatim, so the link
 * survives.
 */
export async function getInsult(
  playerName: string,
  display: string = playerName,
): Promise<string> {
  // Easter egg: socktastic occasionally gets the clip instead of an insult.
  if (playerName.toLowerCase() === "socktastic" && Math.random() * 100 < 25) {
    return SOCKTASTIC_CLIP;
  }

  const url = `${INSULT_API}?template=${encodeURIComponent(`${display} is <adjective>`)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return fallback(display);
    const body = (await res.json()) as { insult?: string };
    return body.insult ?? fallback(display);
  } catch {
    return fallback(display);
  }
}
