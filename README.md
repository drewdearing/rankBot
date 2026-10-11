# rankBot

A Discord bot that pulls power-ranking data from [Braacket](https://braacket.com)
and assigns Discord roles based on where a player sits in the rankings.

Rebuilt in **TypeScript** on **discord.js v14 slash commands**, with **Firestore**
(typed via [Typesaurus](https://typesaurus.com)) for storage.

## Features

1. Server members claim a player name (tag) on the power ranking.
2. rankBot assigns roles based on the percentile a player is ranked in.
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
| `/league update [force]` | Pull the latest ranking data. Skips work when the ranking is unchanged; `force:true` re-scrapes anyway. Resumable — re-run if it reports players still pending. |
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
| `DEV_BOT_TOKEN` | no | Token of a **separate** dev bot, used when `BOT_ENV=dev`. Falls back to `BOT_TOKEN`. |
| `DEV_CLIENT_ID` | no | The dev bot's client id (for dev command registration). Falls back to `DISCORD_CLIENT_ID`. |
| `DEV_GUILD_ID` | no | In dev mode, register commands to this guild only (instant). Production always registers globally. |

## Local development

Requires **Node 22+**.

```sh
npm install
cp .env.example .env        # then fill in the values
npm run doctor              # preflight: env, Firestore, Discord token, deploy tooling
npm run register:dev        # register commands to your DEV_GUILD_ID (instant), as the dev bot
npm run dev                 # run the dev bot with hot reload (tsx)
npm test                    # run unit tests
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

The build is wired into `heroku-postbuild` (`tsc` → `dist/`), so it runs on Heroku's
builder regardless of how you deploy. The `Procfile` registers slash commands in the
`release` phase and runs the bot as a `worker` dyno. Set the config vars above with
`heroku config:set` (never commit them).

**One command** (Firestore rules → Heroku), after a one-time `firebase login`,
`heroku git:remote -a <app>`, and config vars:

```sh
npm run deploy                 # tests → deploy Firestore rules/indexes → push to Heroku
npm run deploy -- --rules      # Firestore rules/indexes only
npm run deploy -- --heroku     # Heroku only
```

It refuses to push to Heroku with an uncommitted tree (Heroku deploys committed code).
Under the hood it's just:

```sh
firebase deploy --only firestore:rules,firestore:indexes   # Firestore rules + indexes
git push heroku HEAD:master                                 # build + run on Heroku
```

**Deploy from GitHub instead:** in the Heroku dashboard, connect the repo and enable
**Automatic deploys** from `master`. Heroku pulls from GitHub and runs the same build
(use `npm run deploy -- --rules` for the Firestore side).

## Built With

- [discord.js](https://discord.js.org) — Discord API client (slash commands)
- [Typesaurus](https://typesaurus.com) — typed Firestore ODM (on firebase-admin)
- [cheerio](https://cheerio.js.org/) — HTML parsing for the Braacket scraper
- [zod](https://zod.dev) — environment validation

## Author

- **Drew Dearing** — [drewdearing](https://github.com/drewdearing)
