# rankBot architecture

How the bot is put together and why. [CLAUDE.md](../CLAUDE.md) holds the commands, rules and
traps; the [README](../README.md) holds the user-facing commands and setup. When this file and the
code disagree, trust the code and fix this file.

## Runtime and stack

- **Node ≥ 22** (`engines`; development and CI use 24). **TypeScript** with `strict` and
  `noUncheckedIndexedAccess`; **ESM** (`module: NodeNext`, target ES2022). `tsc` compiles `src/`
  to `dist/`, which is gitignored: Heroku builds it in `heroku-postbuild`.
- **discord.js 14**, intents `Guilds` and the privileged `GuildMembers` (enabled in the Developer
  Portal; needed to assign roles). There are no message commands, so no MessageContent intent.
- **firebase-admin 13 with Typesaurus 10**, a typed Firestore ODM. The Admin SDK bypasses security
  rules, so `firestore.rules` denies everything as defence in depth and the service-account JSON is
  the real security boundary.
- **cheerio** parses braacket's HTML; **undici** provides `fetch` and `ProxyAgent`; **zod**
  validates the environment; **dotenv** loads `.env`. Dev: tsx, vitest, `@types/node`.
- **One Heroku worker, no HTTP server.** The `Procfile`'s `release` phase runs
  `node dist/discord/register.js`, which registers the slash commands globally on every deploy;
  `worker` runs `node dist/index.js`.

## Entry point and shutdown

`src/index.ts`: `configureBraacketProxy` → `initFirebase` → `createClient` → `InteractionCreate`
dispatches through `commandsByName` → `login`. A command that throws gets a generic ephemeral
reply.

On SIGTERM (a Heroku deploy or dyno cycle) or SIGINT, `shutdownCoordinator.begin()`
(`src/util/shutdown.ts`) aborts in-flight work and waits up to 25 s, inside Heroku's ~30 s window,
for tracked replies to land; only then is the client destroyed, because the pending `editReply`
needs the client's REST handler. A deploy that lands mid-scrape therefore replies "restarted, run
again" instead of leaving the interaction hanging.

## Configuration

`src/config.ts` is the only module that reads `process.env`. Required: `BOT_TOKEN`,
`DISCORD_CLIENT_ID`, `FIREBASE_SERVICE_ACCOUNT` (the whole service-account JSON as one string).
Optional: `DEV_BOT_TOKEN`, `DEV_CLIENT_ID`, `DEV_GUILD_ID` (the dev bot) and `BRAACKET_PROXY_URL`
(prod only).

`BOT_ENV=dev`, set by `npm run dev` and `npm run register:dev`, selects the dev bot's token and
client id and registers commands to `DEV_GUILD_ID` only. Without it, the prod credentials are used
and commands register globally. The dev bot exists because one token on two gateway connections
makes them fight. Dev never uses the proxy: it runs from a residential IP, and proxy bandwidth is
paid. Firestore is shared between dev and prod unless `FIREBASE_SERVICE_ACCOUNT` points at another
project.

## Firestore data model

One document per record (`src/db/schema.ts`); all access goes through `src/db/repo.ts`.

```
guilds/{guildId}                       → { leagueId }
guilds/{guildId}/members/{userId}      → { tag }   (the raw player name, lowercased)
leagues/{leagueId}                     → { owner, mods[], private, service, serviceId, ranks[],
                                           maxPoints, totalPlayers, rankingSignature? }
leagues/{leagueId}/players/{playerKey} → { id, name, points?, rank?, active, url, rankingVersion? }
```

- One league can serve several guilds.
- `ranks[]` holds the role rules (`role`, `percentile`, `activeRequired`), kept sorted by
  threshold.
- `maxPoints` and `totalPlayers` are recomputed on every update. `totalPlayers` is braacket's
  listing total (the N in "X out of N"), not the number of stored players.
- `private` is written but never read. `rankingSignature` is informational only (see below).
- The player document id is `playerKey(name)` (`src/util/playerKey.ts`): the lowercased name with
  `%` and then `/` percent-escaped, and the reserved ids `.`, `..` and `__x__` prefixed. Names
  contain `/`, which Firestore ids forbid; a name with a slash crashed prod. The encoding is
  injective, so two names never share a key (a plain `/` → `-` replacement would collide), and
  therefore NOT idempotent: apply it only to a raw name. A member's `tag` keeps the raw lowercased
  name (the 2019 format, so no tag migration was needed) and is converted at lookup.

## Scraping braacket (`src/services/braacket.ts`)

braacket has no API; the bot parses its pages. The parsers are pure and tested against the saved
pages in `test/fixtures/`.

- **Roster:** the listing `/league/{id}/player?rows=200&page=N`. Rows are links in
  `table.my-table-checkbox`; a row with `i.fa-ban` is excluded from the ranking (never stored);
  the total comes from `div.my-input-group-addon`.
- **Player detail:** `/league/{id}/player/{uuid}`. The rank box is the
  `div.my-dashboard-values-main` containing "out of"; points and the activity requirement are in
  `div.my-dashboard-values-sub`, and a `<span>` in the activity box means inactive. No rank box
  means "Not available".
- **Version:** `/league/{id}/ranking?rows=1`. The `tr.active` row gives the ranking id (its
  `/ranking/{uuid}` link) and the last-compute timestamp (its `[title]` tooltip).
- **`getHtml`** retries 429, 5xx and network errors with backoff and jitter, honouring
  `Retry-After` (capped at 30 s). A 404 on a league's page becomes `LeagueNotFoundError`; neither
  that nor an abort is ever retried. `describeError` unwraps undici's `cause` chain, so a proxy
  407 shows up in the logs instead of a bare "fetch failed".
- **Proxy (prod only):** Cloudflare returns 403 to Heroku's datacenter IPs on IP/ASN reputation
  (changing the User-Agent didn't help), so prod routes braacket requests — only those, never
  Discord or Firebase — through a residential proxy given by `BRAACKET_PROXY_URL`. A residential
  IP is rate-limited after a request or two, so a literal `{session}` in the URL is replaced on
  every attempt to draw a fresh exit IP. When proxied, a 403 is retryable, the attempt limit rises
  from 4 to 8, and retries wait a flat 500 ms. Proxied runs are 5–10× slower.

## `/league update` (`runLeagueUpdate`, `src/services/leagueUpdate.ts`)

1. Start a hard 12-minute deadline (`AbortSignal.timeout`) at the top of the run, combined with
   the shutdown signal through `AbortSignal.any`. It covers every fetch, so the final reply always
   lands inside Discord's 15-minute interaction token.
2. Fetch the version, `rankingId|lastUpdated`.
3. Fetch the roster and drop excluded players.
4. If `force`, wipe all stored players — only now, after the roster fetch succeeded, so a braacket
   outage never empties the database.
5. Load the stored players and delete any that left the roster.
6. Pending = a missing row, a different `rankingVersion`, or a changed `url` (a new braacket UUID
   under the same name). An unreadable `lastUpdated` makes every player pending.
7. Nothing pending → update the aggregates and return `uptodate`.
8. Otherwise fetch details with concurrency 4 and upsert every fetched player stamped with the
   version, "Not available" ones included (`active: false`, no rank or points).
9. If every pending player was attempted, re-fetch the version. Unchanged → `finishLeagueRefresh`
   and `complete`, and the command applies roles. Changed → `superseded`, nothing committed. If
   the deadline came first → `partial`, with fetched, remaining and failed counts.

The command handler adds an in-memory per-league lock (a `Set`), an immediate `deferReply()`, and
`shutdownCoordinator.track(...)`. The orchestrator receives its I/O through `UpdateDeps`, which is
how the tests drive it with fakes. A forced rebuild of a large league takes several runs through
the proxy; each plain `/league update` resumes where the last one stopped.

## Roles and permissions

- `resolveRoleForPlayer` (`src/services/roles.ts`) walks the sorted rules and keeps the highest one
  the player meets: `points >= percentile × maxPoints`, and active if the rule requires it.
  `src/discord/roles.ts` applies the result to Discord members.
- `hasModPermission`: Discord Administrator, or a highest role above the bot's managed role.
  Needed for `/league set`, `/league ranks update`, and `/tag unlink <player>` (which unlinks that
  player from everyone).
- `isLeagueManager`: the league's owner or someone in its `mods[]`. Needed for `/league update`,
  `service`, `mod add|remove` and `ranks add|remove`. `/league delete` is owner-only.
- `/help` is generated from the command registry (`buildHelpCommand`), so it can't drift from the
  real commands. Mod commands carry a coarse label rather than being filtered per user, because
  the permission checks differ by subcommand.

## Decisions and what was rejected

- **TypeScript ESM, modular `src/`, compiled `dist/` not committed** — replacing the 2019
  single-file discord.js v11 bot, which stopped working with the Discord API.
- **Slash commands** instead of the old `!` prefix.
- **One Firestore document per record** instead of the 2019 single-document maps, which hit
  Firestore's 1 MB per-document limit. The migration carried over only config (guild → league
  links, league config, tag claims); players are re-scraped. The old top-level `members/` and
  `players/` collections are obsolete.
- **Roster from the listing page, data from each detail page.** The `/ranking` page lists only
  active players (a league where everyone is inactive showed it), and only the detail page tells
  active, ranked-but-inactive and "Not available" players apart.
- **Version keyed on the last-compute timestamp alone.** The "Up to date" / "Out of date" label
  means pending inputs differ from the displayed computation, not that the shown data changed.
  Composite keys, content hashes, counts and keying on the label were all tried and rejected.
  Accepted residual: two recomputes in the same minute.
- **No early skip when the version matches.** A row went missing with no version change and was
  never healed (the ranked count silently dropped from 147 to 144), so every run fetches the roster
  and re-scrapes whatever is missing or stale.
- **Store every non-excluded player with a version stamp.** An earlier "store only ranked players"
  rule left hundreds of "Not available" players pending forever, so a refresh never converged; with
  them stored it converges in about three runs.
- **Resume by version, not wall-clock** — replacing `refreshStartedAt`, `player.updatedAt` and a
  "restart if stale for an hour" rule. If the ranking recomputes mid-resume, every player
  mismatches and is refetched, so a snapshot never mixes two computations; the end-of-run re-check
  (`superseded`) closes the same window inside one run.
- **`force` wipes, then runs the normal flow**, so a forced rebuild resumes like any other run.
  Rejected: a generation or nonce field on the league document, and a runtime gate.
- **A hard deadline, not a soft one.** A soft budget let an in-flight proxied request outlast
  Discord's 15-minute token, and prod failed with "Invalid Webhook Token".
- **Concurrency 4**, to be polite to braacket; retries absorb throttling.
- **An in-memory lock for `/league update`.** One worker makes it race-free and a restart clears
  it; a Firestore lock or transaction was rejected as unnecessary. Overlapping runs would compete
  for proxy IPs and double the bandwidth.
- **`.firebaserc` gitignored** (template: `.firebaserc.example`), so a fork can point the CLI at
  its own project; `firebase.json`, the rules and the indexes are committed.
- **Deploys through GitHub Actions** (2026-10): a merge to `master` runs the checks and pushes the
  commit to Heroku (`.github/workflows/deploy.yml`), replacing `git push heroku` from the laptop,
  which shipped whatever branch was checked out. Firestore rules and indexes and Heroku config vars
  still go out through `scripts/deploy.sh --rules` / `--env`, before the code that needs them is
  merged. Heroku's GitHub integration is not used.
