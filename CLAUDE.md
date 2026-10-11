# rankBot — notes for coding agents

A Discord bot (TypeScript, discord.js v14 slash commands). `/league update` scrapes a braacket.com
league's power ranking into Firestore (Typesaurus on firebase-admin), members claim their player
name with `/tag set`, and each member gets the highest role rule they qualify for. A rule's
`percentile` is a FRACTION OF THE LEAGUE'S TOP SCORE, not a rank percentile: a player qualifies
when `points >= percentile × maxPoints`, and a rule marked `activeRequired` applies only to active
players (`resolveRoleForPlayer`, src/services/roles.ts). Runs as one Heroku worker dyno. Drew
Dearing owns it. Architecture, the update algorithm and the decisions behind them:
[docs/architecture.md](docs/architecture.md).

## Branches, shipping, deploys
- `master` is the live code, and a push to it deploys: `.github/workflows/deploy.yml` runs the
  checks, then pushes the commit to Heroku. Pull requests to `master` run
  `.github/workflows/checks.yml` (typecheck and tests), which `master` requires.
- Work on `agent/<topic>` branches cut from `origin/master`. Never push to `master`, never
  force-push a shared branch, and never merge: Drew merges, and a merge is a deploy.
- Never deploy, and never run anything against prod: no `npm run deploy` or `deploy:rules`, no
  `git push heroku`, no Heroku or Firebase CLI. Firestore rules and indexes and Heroku config vars
  are deployed by Drew with `npm run deploy -- --rules` / `--env` from a machine with the logins.
- Backend first: a pull request that changes `firestore.rules` or `firestore.indexes.json`, or
  needs a new or changed config var, says so in its description; those are deployed before it
  merges. Keep them compatible with the code that is live until the merge deploys.

## Commands
```sh
npm ci                 # Node 24 (engines: >=22); CI uses 24
npm run typecheck      # tsc --noEmit — src/ only (tsconfig excludes test/)
npm test               # vitest: 55 tests in 7 files, offline (HTML fixtures), no credentials
npm run build          # tsc -> dist/ (gitignored; Heroku builds it in heroku-postbuild)
npm run dev            # BOT_ENV=dev tsx watch — the dev bot; needs .env with the DEV_* values
npm run register:dev   # register slash commands to DEV_GUILD_ID only
```
Don't run these unless told to; they use PROD credentials or ship to prod: `npm start`,
`npm run register`, `npm run doctor`, `npm run deploy`, `npm run deploy:rules`.
Before you call work done: `npm run typecheck && npm test`, and report the test count.

## Layout
- `src/index.ts` — entry point: `configureBraacketProxy` → `initFirebase` → `createClient` →
  `InteractionCreate` dispatches through the command registry → `login`. SIGTERM/SIGINT run the
  graceful shutdown.
- `src/config.ts` — zod-validated env and the dev/prod split. The ONLY place that reads
  `process.env`.
- `src/db/` — `firebase.ts`; `schema.ts` (the data model); `repo.ts` (all Firestore access).
- `src/discord/` — `client.ts`, `register.ts`, `permissions.ts`, `roles.ts` (applies roles),
  `format.ts`, `commands/` (one file per command; register new ones in `commands/index.ts`
  `baseCommands` with `help` metadata — `/help` is generated from the registry).
- `src/services/` — `braacket.ts` (scraper: pure parsers plus `getHtml` with retry, proxy and
  abort), `leagueUpdate.ts` (the `/league update` orchestrator; its I/O is injected through
  `UpdateDeps`, so test it with fakes), `roles.ts` (pure `resolveRoleForPlayer`), `insult.ts`.
- `src/util/` — `playerKey.ts`, `shutdown.ts` (`ShutdownCoordinator`), `concurrency.ts`,
  `logger.ts`.
- `src/scripts/doctor.ts` (preflight), `scripts/deploy.sh` (rules and env deploys),
  `firestore.rules` (deny-all), `test/` (vitest files plus `test/fixtures/*.html`).
- `Procfile` — `release: node dist/discord/register.js` re-registers the slash commands GLOBALLY on
  every deploy; `worker: node dist/index.js`.

## Conventions
- ESM with `module: NodeNext`: imports in `src/` use `.js` suffixes even for `.ts` files; tests
  import `../src/x.ts`. Leave both as they are.
- Strict TypeScript with `noUncheckedIndexedAccess`. No `any` shortcuts.
- Comments explain WHY, often naming the real incident. Keep them true when behaviour changes.
- Log through `log` (src/util/logger.ts). Never log a secret or the proxy URL.
- Reply through `reply()` in `commands/util.ts`. Call `deferReply()` before any braacket or long
  Firestore work: Discord's initial-response window is about 3 s.
- Every behaviour decision has a test. A new or changed scraper selector means an updated fixture
  and a parser test in the same change.
- Commits: imperative subject, a body that explains why. No co-author or session trailers.

## Invariants — each was a real bug or a decided design
1. `playerKey(name)` is the player document id and is NOT idempotent. Apply it only to a raw name:
   at scrape time (`parseRoster`) and to typed input. A member's stored `tag` is the RAW lowercased
   name; look it up with `getPlayer(leagueId, playerKey(tag))`. Never show an encoded key to users.
2. Store EVERY non-excluded player, including "Not available" ones (`active: false`, no rank or
   points), stamped with `rankingVersion`. Skip one and the refresh never converges.
3. No early skip on `rankingSignature` (informational only). A player is pending when its row is
   missing, its version is stale, or its url changed; every run fetches the roster.
4. Version = `rankingId|lastUpdated`, the last-compute timestamp alone. Never key on the "Up to
   date" / "Out of date" label, on counts or on hashes — all were tried and rejected.
5. `force` wipes the players AFTER the roster fetch succeeds, then runs the normal flow. No nonce or
   generation field.
6. Commit (`finishLeagueRefresh`, then roles) only after a full pass whose re-fetched version still
   matches; otherwise return `superseded`. Roles apply only on `complete`.
7. The 12-minute budget is a hard `AbortSignal.timeout` started at the top of `runLeagueUpdate`,
   combined with the shutdown signal. `getHtml` treats an abort as terminal (never retried).
8. On shutdown: abort, await tracked replies (up to 25 s), and destroy the Discord client LAST —
   the pending `editReply` needs its REST handler.
9. The `/league update` lock is an in-memory `Set`, correct only because prod is one worker.
10. The braacket proxy is for braacket requests only, and prod only. A 403 is retryable only when
    proxied; `{session}` rotates per attempt.

## Traps
- Firestore is SHARED between dev and prod unless `FIREBASE_SERVICE_ACCOUNT` points at another
  project: a dev-bot `/league update` writes prod data.
- No `BOT_ENV` means prod credentials. `npm run dev` without `DEV_BOT_TOKEN` falls back to the prod
  token and fights the live bot on the gateway. zod requires `BOT_TOKEN` and `DISCORD_CLIENT_ID`
  even in dev; placeholders are fine there.
- Every deploy re-registers commands globally (the `release` phase), so a broken command
  definition breaks prod's commands; global propagation can take up to about an hour.
- `npm run typecheck` skips `test/`, and vitest doesn't type-check: a type error in a test passes.
- `scripts/deploy.sh` runs doctor → tests → rules → env sync → build → clean-tree check → push, or
  a subset with `--rules`, `--env`, `--heroku`. A bare `npm run deploy` or `--heroku` pushes
  whatever `HEAD` is to Heroku; the workflow does that now. `doctor` needs the Firebase and Heroku
  CLIs, `.firebaserc` and the `heroku` remote, so it fails in a bare VM.
- Prod can't scrape braacket without `BRAACKET_PROXY_URL` (Cloudflare blocks Heroku's IPs). For
  IPRoyal, the session, country and lifetime parameters go in the password part of the URL, and
  `{session}` must appear literally; a leftover placeholder gives a 407.
- If braacket's HTML changes, update the fixture in `test/fixtures/` and the parser together.
- Never commit `.env`, `.firebaserc`, a service-account JSON or a proxy URL. Name secrets; never
  quote them. Keep real player names out of docs.

## Working with Drew
- Bring a plan with its trade-offs and let him decide; he asks focused questions one at a time.
- Verify versions and currency (Node LTS, package versions) instead of asserting them from memory,
  and say how you checked. Explain why you chose any tooling.
- Don't over-scaffold: no new CI, tooling or abstractions unless asked.
