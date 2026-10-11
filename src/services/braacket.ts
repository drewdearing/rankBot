import * as cheerio from "cheerio";
import { fetch, ProxyAgent } from "undici";
import { playerKey } from "../util/playerKey.js";
import { log } from "../util/logger.js";

/**
 * Braacket scraper.
 *
 * A faithful read of a league's data requires per-player detail pages, because
 * the listing/ranking pages can't distinguish the three states the bot cares
 * about (all of which occur within a single league):
 *   - ranked + active        -> store with active: true
 *   - ranked + inactive       -> store with active: false (detail page shows a
 *                                danger <span> in the "Activity requirement" box)
 *   - "Not available"         -> no results; skip
 *
 * So we enumerate the roster from the listing page, then fetch each player's
 * detail page. There is no reliable cheap "did anything change" signal on
 * braacket (the default ranking or its settings can change with no new
 * tournament), so callers refresh the whole roster; resumability is handled by
 * the update orchestrator, not by caching here.
 */

const BASE_URL = "https://braacket.com";
const ROWS_PER_PAGE = 200;

// Present a current desktop-browser User-Agent. NOTE: from a flagged datacenter
// IP (e.g. Heroku) this alone will NOT defeat a Cloudflare 403 — that block is
// keyed on IP/ASN reputation and TLS fingerprint, not the UA string (verified:
// braacket serves the real page to curl/empty UAs from a clean IP). This is kept
// current only as cheap hygiene; the real fix for a 403 is changing the egress IP.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) " +
  "Gecko/20100101 Firefox/140.0";

/**
 * Optional outbound proxy for braacket requests only, configured at startup via
 * {@link configureBraacketProxy}. Scoped to this module's {@link getHtml}, so
 * Discord/Firebase traffic never routes through it. Exists to get past
 * Cloudflare's datacenter-IP 403 on Heroku by egressing from a residential IP.
 *
 * braacket rate-limits any single residential IP after a request or two, so the
 * proxy URL may contain a literal {@link PROXY_SESSION_PLACEHOLDER} token:
 * getHtml swaps it for a fresh value each attempt, giving every retry a new exit
 * IP (e.g. an IPRoyal `_session-{session}_` sticky id). Without the placeholder
 * the URL is used as-is — one fixed IP, fine only for a provider that rotates on
 * its own.
 */
const PROXY_SESSION_PLACEHOLDER = "{session}";

/** The configured proxy URL (possibly a {session} template); undefined = direct. */
let proxyUrlTemplate: string | undefined;
/** Reused agent when the URL has no {session} placeholder (nothing to rotate). */
let fixedProxyDispatcher: ProxyAgent | undefined;
let proxySessionSeq = 0;

/**
 * Route braacket requests through `proxyUrl`, or clear it with undefined. Fails
 * soft: a malformed URL logs and leaves scraping on the direct connection rather
 * than crashing the whole bot (which would take down every other command too).
 * Never logs the URL itself — it carries proxy credentials.
 */
export function configureBraacketProxy(proxyUrl?: string): void {
  proxyUrlTemplate = undefined;
  fixedProxyDispatcher = undefined;
  if (!proxyUrl) return;
  try {
    // Validate by constructing an agent for a concrete URL (a dummy session).
    const dispatcher = new ProxyAgent(resolveProxyUrl(proxyUrl, "probe"));
    proxyUrlTemplate = proxyUrl;
    if (proxyUrl.includes(PROXY_SESSION_PLACEHOLDER)) {
      log.info("braacket: routing requests through proxy (fresh IP per retry).");
    } else {
      fixedProxyDispatcher = dispatcher;
      log.info("braacket: routing requests through configured proxy.");
    }
  } catch (err) {
    proxyUrlTemplate = undefined;
    log.error(
      `braacket: invalid proxy URL, using direct connection: ${String(err)}`,
    );
  }
}

/** Substitute every session placeholder in a proxy URL template. */
function resolveProxyUrl(template: string, session: string): string {
  return template.split(PROXY_SESSION_PLACEHOLDER).join(session);
}

/**
 * The dispatcher for the next attempt: a fresh agent with a new session token
 * (=> new exit IP) when the URL is a {session} template, the one reused agent
 * for a fixed URL, or undefined (direct) when no proxy is configured.
 */
function nextProxyDispatcher(): ProxyAgent | undefined {
  if (!proxyUrlTemplate) return undefined;
  if (fixedProxyDispatcher) return fixedProxyDispatcher;
  const session = `rb${Date.now().toString(36)}${proxySessionSeq++}`;
  return new ProxyAgent(resolveProxyUrl(proxyUrlTemplate, session));
}

const PLAYER_UUID_RE = /\/player\/([0-9A-Fa-f-]{36})/;

/** The public braacket page for a league. */
export function leagueUrl(serviceId: string): string {
  return `${BASE_URL}/league/${serviceId}`;
}

/** Build the canonical detail-page URL for a player uuid within a league. */
export function playerUrl(serviceId: string, uuid: string): string {
  return `${BASE_URL}/league/${serviceId}/player/${uuid}`;
}

/** Pull the player uuid out of a detail-page URL, or null if there isn't one. */
export function playerUuidFromUrl(url: string): string | null {
  return PLAYER_UUID_RE.exec(url)?.[1] ?? null;
}

/**
 * Extract a player uuid from a *user-pasted* braacket link. Returns null for
 * anything that isn't a braacket player URL, so plain names fall through and we
 * never fetch an arbitrary user-supplied host.
 */
export function parsePlayerUrl(input: string): string | null {
  if (!/braacket\.com/i.test(input)) return null;
  return playerUuidFromUrl(input);
}

export class BraacketError extends Error {}
export class LeagueNotFoundError extends BraacketError {}

/** One entry from a league's player listing. */
export interface RosterEntry {
  /** Lowercased display name — the player document id. */
  id: string;
  name: string;
  /** Detail-page URL (carries the player UUID). */
  url: string;
  /** Manually excluded from the ranking (fa-ban icon in the listing). */
  excluded: boolean;
}

/** Parsed result of a single player detail page. */
export type PlayerDetail =
  | { available: false }
  | { available: true; rank?: number; points?: number; active: boolean };

// ---------------------------------------------------------------------------
// Pure parsers (unit-tested against saved fixtures)
// ---------------------------------------------------------------------------

export function parseRoster(
  html: string,
  serviceId: string,
): { entries: RosterEntry[]; total: number } {
  const $ = cheerio.load(html);
  const entries: RosterEntry[] = [];
  const seen = new Set<string>();

  $("table.my-table-checkbox tbody a[href*='/player/']").each((_, el) => {
    const link = $(el);
    if (link.hasClass("badge")) return;

    const href = link.attr("href");
    const uuid = href ? PLAYER_UUID_RE.exec(href)?.[1] : undefined;
    if (!uuid) return;

    const name = link.text().trim();
    if (!name) return;

    const id = playerKey(name);
    if (seen.has(id)) return; // dedupe shared names (first occurrence wins)
    seen.add(id);

    entries.push({
      id,
      name,
      url: playerUrl(serviceId, uuid),
      excluded: link.closest("td").find("i.fa-ban").length > 0,
    });
  });

  return { entries, total: parseTotal($) };
}

export interface RankingState {
  rankingId: string;
  /**
   * When the default ranking was last computed, e.g. "03 June 2026 04:16",
   * read from the status tooltip ("Up to date (…)" / "Out of date (…)"). This
   * identifies the displayed computation — the data we'd scrape. We deliberately
   * ignore the Up/Out-of-date label itself, which only signals that *pending*
   * inputs differ from this computation, not that the shown data changed. Empty
   * if it couldn't be read.
   */
  lastUpdated: string;
}

/**
 * Read the default ranking's id and last-computed timestamp from the `/ranking`
 * selector's active row. Braacket bumps this timestamp when it recomputes the
 * ranking — which it does after anything that changes standings (a new
 * tournament, a player exclusion, edited settings) — so (rankingId, lastUpdated)
 * is a single authoritative signal for whether the displayed data has changed.
 */
export function parseRankingState(html: string): RankingState {
  const $ = cheerio.load(html);

  const activeRow = $("tr.active")
    .filter((_, el) => $(el).find("a[href*='/ranking/']").length > 0)
    .first();
  if (activeRow.length > 0) {
    const href = activeRow.find("a[href*='/ranking/']").first().attr("href") ?? "";
    const rankingId = /\/ranking\/([0-9A-Fa-f-]{36})/.exec(href)?.[1] ?? "";
    if (rankingId) {
      let lastUpdated = "";
      activeRow.find("[title]").each((_, el) => {
        if (lastUpdated) return;
        const stamp = /(?:Up to date|Out of date) \(([^)]+)\)/.exec(
          $(el).attr("title") ?? "",
        )?.[1];
        if (stamp) lastUpdated = stamp.trim();
      });
      return { rankingId, lastUpdated };
    }
  }

  // Fallback (e.g. single-ranking leagues): the active ranking id appears as a
  // `?ranking=` query param on the player/ranking row links.
  const href = $("a[href*='ranking=']").first().attr("href") ?? "";
  const rankingId = /[?&]ranking=([0-9A-Fa-f-]{36})/.exec(href)?.[1] ?? "";
  return { rankingId, lastUpdated: "" };
}

export function parsePlayerDetail(html: string): PlayerDetail {
  const $ = cheerio.load(html);
  const panel = $("div.panel-body");

  // The rank box is the dashboard "main" value containing "out of"
  // (e.g. "16th out of 1375"). Its absence means the player isn't ranked.
  const rankBox = panel
    .find("div.my-dashboard-values-main")
    .filter((_, el) => $(el).text().includes("out of"))
    .first();
  if (rankBox.length === 0) return { available: false };

  const rank = parseFirstInt(rankBox.text());
  let points: number | undefined;
  let active = true;

  panel.find("div.my-dashboard-values-sub").each((_, el) => {
    const sub = $(el);
    const label = sub.children("div").first().text().trim();
    if (label === "Points") {
      points = parseFirstInt(sub.children("div").eq(1).text());
    } else if (label === "Activity requirement") {
      // A <span> (warning icon) marks an unmet requirement -> inactive.
      active = sub.find("span").length === 0;
    }
  });

  return { available: true, rank, points, active };
}

/**
 * The player's display name from a detail page, read from the document title
 * (`{League} / Player / {Name}`). We split on the full " / Player / " marker so
 * names that themselves contain "/" survive. Undefined if the title isn't shaped
 * that way.
 */
export function parsePlayerName(html: string): string | undefined {
  const $ = cheerio.load(html);
  const title = $("title").first().text();
  const marker = " / Player / ";
  const i = title.indexOf(marker);
  if (i < 0) return undefined;
  return title.slice(i + marker.length).trim() || undefined;
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

/**
 * Enumerate every player in a league from the listing pages. `total` is the
 * listing count braacket reports — which is also the denominator it uses for a
 * player's "X out of N" rank.
 */
export async function fetchRoster(
  serviceId: string,
  signal?: AbortSignal,
): Promise<{ entries: RosterEntry[]; total: number }> {
  const first = await fetchRosterPage(serviceId, 1, signal);
  const pages = Math.max(1, Math.ceil(first.total / ROWS_PER_PAGE));

  const byId = new Map<string, RosterEntry>();
  for (const entry of first.entries) byId.set(entry.id, entry);
  for (let page = 2; page <= pages; page++) {
    const next = await fetchRosterPage(serviceId, page, signal);
    for (const entry of next.entries) {
      if (!byId.has(entry.id)) byId.set(entry.id, entry);
    }
  }
  return { entries: [...byId.values()], total: first.total };
}

/** Fetch and parse a single player's detail page. */
export async function fetchPlayerDetail(
  url: string,
  signal?: AbortSignal,
): Promise<PlayerDetail> {
  return parsePlayerDetail(await getHtml(url, { signal }));
}

/** Fetch a player's detail page and return just their display name. */
export async function fetchPlayerName(url: string): Promise<string | undefined> {
  return parsePlayerName(await getHtml(url));
}

/**
 * Look up a single player by name via braacket's listing search
 * (`/player?search=…`) instead of paging the whole roster. Returns the entry
 * whose name matches exactly (after `playerKey` normalization), or undefined.
 */
export async function fetchPlayerByName(
  serviceId: string,
  name: string,
): Promise<RosterEntry | undefined> {
  const url =
    `${BASE_URL}/league/${encodeURIComponent(serviceId)}/player` +
    `?rows=${ROWS_PER_PAGE}&search=${encodeURIComponent(name)}`;
  const { entries } = parseRoster(await getHtml(url, { serviceId }), serviceId);
  const key = playerKey(name);
  return entries.find((entry) => entry.id === key);
}

/** The default ranking's id + last-computed timestamp. One request. */
export async function fetchRankingState(
  serviceId: string,
  signal?: AbortSignal,
): Promise<RankingState> {
  return parseRankingState(
    await getHtml(
      `${BASE_URL}/league/${encodeURIComponent(serviceId)}/ranking?rows=1`,
      { serviceId, signal },
    ),
  );
}

async function fetchRosterPage(
  serviceId: string,
  page: number,
  signal?: AbortSignal,
): Promise<{ entries: RosterEntry[]; total: number }> {
  const url =
    `${BASE_URL}/league/${encodeURIComponent(serviceId)}/player` +
    `?rows=${ROWS_PER_PAGE}&page=${page}`;
  return parseRoster(await getHtml(url, { serviceId, signal }), serviceId);
}

const MAX_ATTEMPTS = 4;
// A proxied request gambles on a fresh residential IP each attempt (many are
// rate-limited or blocked), so it needs more tries to land a clean one.
const MAX_ATTEMPTS_PROXIED = 8;
const RETRY_BASE_MS = 600;
const MAX_RETRY_WAIT_MS = 30_000;
// Re-rolling to a new IP isn't about calming an overloaded origin, so use a short
// flat delay between proxied attempts instead of growing exponential backoff.
const PROXY_REROLL_DELAY_MS = 500;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * GET a braacket page with polite retry/backoff. Transient failures (429, 5xx,
 * network errors) are retried, honoring a `Retry-After` header when present, so
 * a large refresh can ride out throttling instead of leaving players unfetched.
 * 404 (unknown league) is never retried.
 *
 * When a proxy is configured, each attempt egresses from a fresh IP (see
 * {@link nextProxyDispatcher}) and `403` is treated as retryable too — through a
 * residential proxy it means "this IP is blocked", which the next IP may not be.
 */
async function getHtml(
  url: string,
  opts: { serviceId?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const { serviceId, signal } = opts;
  const maxAttempts = proxyUrlTemplate ? MAX_ATTEMPTS_PROXIED : MAX_ATTEMPTS;
  const aborted = (): BraacketError =>
    new BraacketError("Braacket request aborted (run deadline reached)");
  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) throw aborted();
    const dispatcher = nextProxyDispatcher();
    const proxied = dispatcher !== undefined;
    // A per-attempt (rotating) agent must be closed after use or it leaks
    // sockets; the reused fixed agent and the default dispatcher must not be.
    const closeAgent = (): void => {
      if (proxied && dispatcher !== fixedProxyDispatcher) {
        void (dispatcher as ProxyAgent).close().catch(() => {});
      }
    };
    const retryDelay = (): number =>
      proxied ? PROXY_REROLL_DELAY_MS : backoffMs(attempt);

    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch(url, {
        headers: { "user-agent": USER_AGENT },
        dispatcher,
        signal,
      });
    } catch (err) {
      closeAgent();
      // A deadline abort is terminal — never retry it, and don't misreport it as
      // a transient network failure.
      if (signal?.aborted) throw aborted();
      if (attempt >= maxAttempts) {
        throw new BraacketError(`Braacket request failed: ${describeError(err)}`);
      }
      await sleep(retryDelay(), signal);
      continue;
    }

    if (res.status === 404 && serviceId) {
      await drainBody(res);
      closeAgent();
      throw new LeagueNotFoundError(`Braacket league not found: ${serviceId}`);
    }
    if (res.ok) {
      const body = await res.text();
      closeAgent();
      return body;
    }

    const retryable =
      RETRYABLE_STATUS.has(res.status) || (proxied && res.status === 403);
    const retryAfter = retryAfterMs(res.headers.get("retry-after"));
    await drainBody(res);
    closeAgent();
    if (retryable && attempt < maxAttempts) {
      await sleep(retryAfter ?? retryDelay(), signal);
      continue;
    }
    throw new BraacketError(`Braacket request failed (${res.status})`);
  }
}

/** Discard an unread response body so its connection can be freed/reused. */
async function drainBody(res: Awaited<ReturnType<typeof fetch>>): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // Body already consumed or absent — nothing to free.
  }
}

/**
 * Render an error with its `cause` chain. undici wraps the real reason (a proxy
 * `407`, `ECONNREFUSED`, a TLS error, …) in a generic "fetch failed", so without
 * unwrapping the cause a proxy/network failure is undiagnosable from the logs.
 */
function describeError(err: unknown): string {
  const parts = [String(err)];
  let cause: unknown = (err as { cause?: unknown } | null)?.cause;
  for (let depth = 0; cause != null && depth < 4; depth++) {
    const c = cause as { code?: unknown; message?: unknown };
    parts.push(String(c.code ?? c.message ?? cause));
    cause = (cause as { cause?: unknown }).cause;
  }
  return parts.join(" ← ");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    // Wake early on abort so a long backoff (e.g. a Retry-After) can't delay the
    // deadline; the caller re-checks `signal.aborted` and bails.
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** Exponential backoff with jitter: ~0.6s, 1.2s, 2.4s (+ up to 300ms). */
function backoffMs(attempt: number): number {
  return RETRY_BASE_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 300);
}

/** Parse a `Retry-After` header (delta-seconds or HTTP-date), capped. */
function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.min(Math.max(seconds, 0) * 1000, MAX_RETRY_WAIT_MS);
  }
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_WAIT_MS);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTotal($: cheerio.CheerioAPI): number {
  const text = $("div.my-input-group-addon").first().text();
  const digits = /of\s+([\d,]+)/.exec(text)?.[1];
  return digits ? Number.parseInt(digits.replace(/,/g, ""), 10) : 0;
}

function parseFirstInt(text: string): number | undefined {
  const digits = text.replace(/,/g, "").match(/-?\d+/)?.[0];
  return digits === undefined ? undefined : Number.parseInt(digits, 10);
}
