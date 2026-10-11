import "dotenv/config";
import { z } from "zod";

/**
 * Centralised, validated configuration. All secrets and environment-specific
 * values live here — nothing is hardcoded elsewhere in the codebase.
 */

const EnvSchema = z.object({
  BOT_TOKEN: z.string().min(1, "BOT_TOKEN is required"),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required"),
  FIREBASE_SERVICE_ACCOUNT: z
    .string()
    .min(1, "FIREBASE_SERVICE_ACCOUNT is required"),
  // Optional separate bot for local dev — used when BOT_ENV=dev (set by the
  // `dev` / `register:dev` npm scripts) so it doesn't fight the deployed bot's
  // gateway connection. Falls back to the prod creds if unset.
  DEV_BOT_TOKEN: z.string().optional(),
  DEV_CLIENT_ID: z.string().optional(),
  // In dev mode, slash commands register to this guild only (instant). Prod
  // always registers globally regardless of this value.
  DEV_GUILD_ID: z.string().optional(),
  // Optional outbound proxy for braacket scraping only — a full proxy URL with
  // credentials (`http://user:pass@host:port`), e.g. an IPRoyal residential
  // endpoint. Unset = direct fetch. Exists to get past Cloudflare's datacenter-IP
  // 403 when scraping from Heroku. May include a literal `{session}` token (e.g.
  // inside an IPRoyal `_session-{session}_` param) that the scraper swaps per
  // attempt to draw a fresh exit IP on each retry. Validated leniently (the
  // ProxyAgent constructor is the real check) so a quirky-but-valid proxy URL
  // can't crash startup.
  BRAACKET_PROXY_URL: z.string().min(1).optional(),
});

/** Shape of the downloaded Firebase service-account JSON (snake_case). */
const ServiceAccountSchema = z.object({
  project_id: z.string().min(1, "service account missing project_id"),
  client_email: z.string().min(1, "service account missing client_email"),
  private_key: z.string().min(1, "service account missing private_key"),
});

function fail(message: string): never {
  throw new Error(`Invalid environment configuration:\n${message}`);
}

const env = EnvSchema.safeParse(process.env);
if (!env.success) {
  fail(
    env.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n"),
  );
}

let rawServiceAccount: unknown;
try {
  rawServiceAccount = JSON.parse(env.data.FIREBASE_SERVICE_ACCOUNT);
} catch {
  fail("  - FIREBASE_SERVICE_ACCOUNT: must be valid JSON");
}

const sa = ServiceAccountSchema.safeParse(rawServiceAccount);
if (!sa.success) {
  fail(
    sa.error.issues
      .map((i) => `  - FIREBASE_SERVICE_ACCOUNT.${i.path.join(".")}: ${i.message}`)
      .join("\n"),
  );
}

// `BOT_ENV=dev` (set by the dev npm scripts) selects the dev bot + dev guild.
const isDev = process.env.BOT_ENV === "dev";
if (isDev && !env.data.DEV_BOT_TOKEN) {
  console.warn(
    "⚠ BOT_ENV=dev but DEV_BOT_TOKEN is unset — using the PRODUCTION bot token, " +
      "which will conflict with the deployed bot on Discord's gateway. " +
      "Set DEV_BOT_TOKEN / DEV_CLIENT_ID for an isolated dev bot.",
  );
}

export const config = {
  /** True when running the dev bot (`BOT_ENV=dev`). */
  isDev,
  botToken: isDev
    ? (env.data.DEV_BOT_TOKEN ?? env.data.BOT_TOKEN)
    : env.data.BOT_TOKEN,
  clientId: isDev
    ? (env.data.DEV_CLIENT_ID ?? env.data.DISCORD_CLIENT_ID)
    : env.data.DISCORD_CLIENT_ID,
  // Prod always registers globally; only dev mode scopes to the dev guild.
  devGuildId: isDev ? env.data.DEV_GUILD_ID : undefined,
  /**
   * Optional proxy URL for braacket requests only (undefined = direct). Prod
   * only: local dev runs from a residential IP Cloudflare doesn't block, so dev
   * skips the proxy to avoid burning paid bandwidth.
   */
  braacketProxyUrl: isDev ? undefined : env.data.BRAACKET_PROXY_URL,
  /** Mapped to the firebase-admin `ServiceAccount` (camelCase) shape. */
  serviceAccount: {
    projectId: sa.data.project_id,
    clientEmail: sa.data.client_email,
    privateKey: sa.data.private_key,
  },
} as const;

export type Config = typeof config;
