/**
 * Preflight checks before going live / deploying: `npm run doctor`.
 *
 * Runtime — can the bot run?
 *   1. env/config is valid (importing ./config runs the zod validation),
 *   2. Firestore is reachable with the service account,
 *   3. the Discord bot token is valid.
 * Deploy tooling — can you ship it? (used by `npm run deploy`)
 *   4. Firebase CLI installed + authenticated (firestore rules),
 *   5. Heroku CLI installed + authenticated,
 *   6. the `heroku` git remote is configured.
 *
 * Exits non-zero if anything fails, so it's safe to gate a deploy on it.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { REST, Routes } from "discord.js";
import { config } from "../config.js";
import { initFirebase } from "../db/firebase.js";
import { db } from "../db/schema.js";
import { log } from "../util/logger.js";

interface CmdResult {
  status: number | null;
  stdout: string;
  stderr: string;
  missing: boolean; // executable not found on PATH
}

function run(cmd: string, args: string[]): CmdResult {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: 20_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: r.status,
    stdout: (r.stdout ?? "").trim(),
    stderr: (r.stderr ?? "").trim(),
    missing: (r.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT",
  };
}

// ---------------------------------------------------------------------------
// Runtime checks
// ---------------------------------------------------------------------------

async function checkFirestore(): Promise<boolean> {
  try {
    initFirebase();
    const guilds = await db.guilds.count();
    log.info(
      `✓ Firestore reachable (project ${config.serviceAccount.projectId}) — ${guilds} guild doc(s).`,
    );
    return true;
  } catch (err) {
    log.error("✗ Firestore check failed:", err);
    return false;
  }
}

async function checkDiscord(): Promise<boolean> {
  try {
    const rest = new REST({ version: "10" }).setToken(config.botToken);
    const me = (await rest.get(Routes.user())) as { id: string; username: string };
    log.info(`✓ Discord token valid — bot user ${me.username} (${me.id}).`);
    if (me.id !== config.clientId) {
      log.warn(
        `  ⚠ DISCORD_CLIENT_ID (${config.clientId}) doesn't match the bot user id (${me.id}); slash-command registration will target the wrong app.`,
      );
    }
    return true;
  } catch (err) {
    log.error("✗ Discord token check failed:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Deploy-tooling checks
// ---------------------------------------------------------------------------

function checkFirebaseCli(): boolean {
  const ver = run("firebase", ["--version"]);
  if (ver.missing) {
    log.error("✗ Firebase CLI not found — install with `npm i -g firebase-tools`.");
    return false;
  }
  const auth = run("firebase", ["login:list"]);
  const text = `${auth.stdout}\n${auth.stderr}`;
  if (auth.status !== 0 || !text.includes("@") || /no .*account/i.test(text)) {
    log.error("✗ Firebase CLI not authenticated — run `firebase login`.");
    return false;
  }
  // .firebaserc is gitignored (per-user); confirm a project has been selected.
  if (!existsSync(".firebaserc")) {
    log.error(
      "✗ No Firebase project selected — run `firebase use --add <your-project-id>`.",
    );
    return false;
  }
  log.info(`✓ Firebase CLI ${ver.stdout} authenticated, project configured.`);
  return true;
}

function checkHerokuCli(): boolean {
  const ver = run("heroku", ["--version"]);
  if (ver.missing) {
    log.error(
      "✗ Heroku CLI not found — install: https://devcenter.heroku.com/articles/heroku-cli",
    );
    return false;
  }
  const who = run("heroku", ["auth:whoami"]);
  if (who.status !== 0) {
    log.error("✗ Heroku CLI not authenticated — run `heroku login`.");
    return false;
  }
  log.info(`✓ Heroku CLI authenticated as ${who.stdout}.`);
  return true;
}

function checkHerokuRemote(): boolean {
  const remote = run("git", ["remote", "get-url", "heroku"]);
  if (remote.status !== 0) {
    log.error("✗ No `heroku` git remote — run `heroku git:remote -a <your-app>`.");
    return false;
  }
  log.info(`✓ Heroku git remote configured (${remote.stdout}).`);
  return true;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log.info("rankBot doctor — preflight checks");

  log.info("· Runtime");
  log.info(
    `  config loaded — commands register ${config.devGuildId ? `to guild ${config.devGuildId}` : "globally"}.`,
  );
  const runtime = await Promise.all([checkFirestore(), checkDiscord()]);

  log.info("· Deploy tooling");
  const deploy = [checkFirebaseCli(), checkHerokuCli(), checkHerokuRemote()];

  const ok = [...runtime, ...deploy].every(Boolean);
  log.info(ok ? "All checks passed ✅" : "Some checks failed ❌");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  log.error("doctor failed:", err);
  process.exit(1);
});
