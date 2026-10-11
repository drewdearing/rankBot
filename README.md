# rankBot

A Discord bot that pulls power-ranking data from [Braacket](https://braacket.com)
and assigns Discord roles based on where a player sits in the rankings.

Rebuilt in **TypeScript** on **discord.js v14 slash commands**, with **Firestore**
(typed via [Typesaurus](https://typesaurus.com)) for storage.

## Features

1. Server members claim a player name (tag) on the power ranking.
2. rankBot gives each member the highest role rule they qualify for (see role rules below).
3. Members can look up their (or anyone's) current rank.

## Commands

| Command | What it does |
| --- | --- |
| `/tag view` | Show your linked player tag. |
| `/tag set <player>` | Claim a player name. |
| `/tag unlink [player]` | Unlink your tag (mods may unlink a player's tag from everyone). |
| `/rank view [player]` | Show a player's rank (defaults to your tag). |
| `/rank update` | Refresh your rank role. |
| `/expose [player]` | Roast a player (defaults to your tag). |
| `/league info` | Show the league linked to this server. |
| `/league set <league_id>` | Link or create a league. |
| `/league service <service> <id>` | Configure the data source (e.g. `braacket`). |
| `/league update [force]` | Pull the latest ranking data, then reapply roles once a full pass completes. Each run re-scrapes only the players who are new, changed or missing, and stops after 12 minutes — run it again to resume. `force:true` wipes the stored players first and rebuilds them all, which can take several runs. |
| `/league delete` | Permanently delete the league (owner only). |
| `/league mod add\|remove <member>` | Manage league mods. |
| `/league ranks add <name> <percentile> <active_required>` | Add a role rule. |
| `/league ranks remove [name] [all]` | Remove a role rule (or all of them). |
| `/league ranks list` | List role rules. |
| `/league ranks update` | Reapply roles to all members. |

A **role rule** maps a role to a `percentile` (a fraction of the league's max
points) and whether the player must be **active** on the ranking to qualify.
Rules are auto-sorted, so a player receives the highest role they qualify for.

**Permissions.** "Server mods" (admins, or anyone whose highest role is above the
bot's role) can run `/league set` and `/league ranks update`. The league **owner**
and league **mods** manage `/league update`, `service`, `mod`, and `ranks add/remove`.

## Setup (adding rankBot to your server)

1. **Invite the bot** with the `bot` and `applications.commands` scopes and the
   **Manage Roles** permission:
   `https://discord.com/api/oauth2/authorize?client_id=<CLIENT_ID>&permissions=268435456&scope=bot%20applications.commands`
2. In the [Developer Portal](https://discord.com/developers/applications) → your app
   → **Bot**, enable the **Server Members Intent** (privileged) — needed to assign roles.
3. Move rankBot's role **above** the rank roles it should manage, and **below** the
   roles allowed to change its settings.
4. Get started: `/league set <league_id>`, then (owner) `/league service braacket <id>`
   and `/league update`.

## Configuration

All config comes from environment variables (see [`.env.example`](./.env.example)):

| Variable | Required | Description |
| --- | --- | --- |
| `BOT_TOKEN` | yes | Production Discord bot token. |
| `DISCORD_CLIENT_ID` | yes | Production application (client) id — used to register commands. |
| `FIREBASE_SERVICE_ACCOUNT` | yes | Firebase service-account JSON, as a single-line string. |
| `DEV_BOT_TOKEN` | no | Token of a **separate** dev bot, used when `BOT_ENV=dev`. Only a *missing* key falls back to `BOT_TOKEN`; an empty `DEV_BOT_TOKEN=` is used as an empty token, so the dev bot fails to log in. |
| `DEV_CLIENT_ID` | no | The dev bot's client id (for dev command registration). Only a *missing* key falls back to `DISCORD_CLIENT_ID`; an empty value is used as is. |
| `DEV_GUILD_ID` | no | In dev mode, register commands to this guild only (instant). Production always registers globally. |
| `BRAACKET_PROXY_URL` | no | Production only (ignored in dev). Proxy URL, with credentials, for braacket.com requests only — Cloudflare blocks braacket for Heroku's IPs, so production needs one. A literal `{session}` in it is replaced on every attempt for a fresh exit IP. |

## Local development

Requires **Node 22+**.

```sh
npm install
cp .env.example .env        # then fill in the values
npm run doctor              # preflight: env, Firestore, Discord token, deploy tooling
npm run register:dev        # register commands to your DEV_GUILD_ID (instant), as the dev bot
npm run dev                 # run the dev bot with hot reload (tsx)
npm run typecheck           # type-check src/
npm test                    # run unit tests (CI runs typecheck and tests on every pull request)
```

`npm run dev` runs the TypeScript directly via `tsx` — no build step needed locally.

**Use a separate dev bot.** A bot token is a single Discord identity, so running
`npm run dev` with the *production* `BOT_TOKEN` while the bot is deployed makes the two
instances fight over Discord's gateway (interactions land unpredictably on either). Create
a second application in the Developer Portal, put its `DEV_BOT_TOKEN` / `DEV_CLIENT_ID` in
`.env`, invite it to a test server, and set `DEV_GUILD_ID`. `npm run dev` and
`npm run register:dev` set `BOT_ENV=dev`, which selects those creds and scopes registration
to your test guild; production (`npm run register`, Heroku) uses `BOT_TOKEN` and registers
globally. Firestore is still shared unless you also point `FIREBASE_SERVICE_ACCOUNT` at a
separate dev project.

## Firestore security rules

The bot uses the Firebase **Admin SDK**, which bypasses Firestore security rules.
The shipped [`firestore.rules`](./firestore.rules) therefore **deny all** client
access (defense-in-depth — only the secret service account can reach the data).

Point the CLI at **your own** Firebase project first (this writes a gitignored
`.firebaserc` — don't run `firebase init`, which would offer to overwrite the
committed rules):

```sh
firebase login
firebase use --add <your-firebase-project-id>
npm run deploy:rules        # firebase deploy --only firestore:rules,firestore:indexes
```

## Deployment

**A merge to `master` deploys.** On every push to `master`,
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs the checks (`npm ci`,
`npm run typecheck`, `npm test`) and then pushes that commit to the Heroku app's git repo,
authenticated by `HEROKU_API_KEY`, a secret of the `production` environment (below). Heroku builds
it (`heroku-postbuild` runs `tsc` → `dist/`), the `Procfile`'s `release` phase re-registers the
slash commands globally, and the `worker` dyno restarts. Pull requests to `master` run the same
checks ([`.github/workflows/checks.yml`](.github/workflows/checks.yml)), and `master` takes changes
only through a pull request whose checks pass. Heroku's own GitHub integration (automatic deploys)
is not used; leave it off, or it would deploy alongside the workflow. To deploy your own copy,
change the app name in `deploy.yml` and set up the environment and token as below.

**The deploy token is an environment secret, never a repository secret.** Every workflow on every
branch can read a repository secret, including one pushed on an `agent/…` branch. The deploy job
runs in the GitHub environment `production`, so:

1. Create the environment first: Settings → Environments → New environment `production` →
   Deployment branches and tags → **Selected branches and tags** → add `master`. (Not "Protected
   branches only", which lets any branch deploy until a branch is protected.)
2. Create a token and store it as that environment's secret, from a machine logged in to Heroku
   and to `gh` as the repository's owner. The token never appears on screen:

   ```sh
   heroku authorizations:create --description "rankBot GitHub Actions deploy" --short --scope write \
     | gh secret set HEROKU_API_KEY --env production --repo drewdearing/rankBot
   ```

   The `write` scope leaves account information and config vars (the bot's secrets) out of the
   token's reach. If Heroku rejects that scope, either when creating the token or when the deploy
   pushes (`Authentication failed`), run the same command without `--scope write` to store a
   default-scope token instead, then re-run the deploy. `heroku authorizations` lists tokens and
   `heroku authorizations:revoke <id>` removes one.

**Firestore rules and indexes, and Heroku config vars, are deployed from a machine with the
logins**, not by the workflow. One-time setup: `firebase login`,
`firebase use --add <your-firebase-project-id>`, `heroku login`, `heroku git:remote -a <app>`, and
a filled-in `.env`. Then:

```sh
npm run deploy -- --rules      # Firestore rules + indexes
npm run deploy -- --env        # sync .env → Heroku config vars
```

`scripts/deploy.sh` first runs `npm run doctor`, a preflight of the env, Firestore, the Discord
token and the deploy tooling (`--skip-doctor` skips it), then `npm test` (`--skip-tests`), then the
steps you picked. `--env` sets `BOT_TOKEN`, `DISCORD_CLIENT_ID`, `FIREBASE_SERVICE_ACCOUNT` and,
if present, `BRAACKET_PROXY_URL` wherever they differ from Heroku's, without printing a value, and
unsets `DEV_BOT_TOKEN`, `DEV_CLIENT_ID` and `DEV_GUILD_ID` on Heroku if any is set there. The
script's remaining step, `--heroku` (also part of a bare `npm run deploy`), pushes whatever `HEAD`
is straight to Heroku; that is the workflow's job now, so don't use it for routine deploys.

**Backend first.** A merge ships its code at once, so whatever the code relies on goes out before
the merge: a pull request that changes `firestore.rules` or `firestore.indexes.json` needs them
deployed (`--rules`) before it merges, and one that needs a new config var needs it set (`--env`)
first. Such changes must also keep working with the code that stays live until the merge.

**Never deploy from an agent.** Coding agents push `agent/…` branches and stop there: they don't
run `npm run deploy` or push to Heroku, and hold no deploy credentials. Drew merges, and the merge
deploys.

## Built With

- [discord.js](https://discord.js.org) — Discord API client (slash commands)
- [Typesaurus](https://typesaurus.com) — typed Firestore ODM (on firebase-admin)
- [cheerio](https://cheerio.js.org/) — HTML parsing for the Braacket scraper
- [zod](https://zod.dev) — environment validation

## Author

- **Drew Dearing** — [drewdearing](https://github.com/drewdearing)
