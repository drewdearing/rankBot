/**
 * Generates playful insults for the `/expose` command via the public
 * insult API, with a graceful fallback if the service is unreachable.
 */

const INSULT_API = "https://insult.mattbas.org/api/insult.json";
const SOCKTASTIC_CLIP = "https://www.youtube.com/watch?v=JOGCsnDbQUk";

function fallback(playerName: string): string {
  return `${playerName} smells... good!`;
}

export async function getInsult(playerName: string): Promise<string> {
  // Easter egg: socktastic occasionally gets the clip instead of an insult.
  if (playerName.toLowerCase() === "socktastic" && Math.random() * 100 < 25) {
    return SOCKTASTIC_CLIP;
  }

  const url = `${INSULT_API}?template=${encodeURIComponent(`${playerName} is <adjective>`)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return fallback(playerName);
    const body = (await res.json()) as { insult?: string };
    return body.insult ?? fallback(playerName);
  } catch {
    return fallback(playerName);
  }
}
