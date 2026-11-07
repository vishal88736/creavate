import { config as dotenv } from "dotenv";
import { z } from "zod";
import { AppError } from "@creavate/shared";
dotenv({ path: process.env.ENV_FILE || ".env", quiet: true });
const optional = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().optional(),
);
const bool = z.preprocess(
  (v) => (v === undefined || v === "" ? "false" : v),
  z.enum(["true", "false"]).transform((v) => v === "true"),
);
const publicKey = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z
    .string()
    .refine((value) => {
      if (value.startsWith("sb_publishable_")) return true;
      try {
        return (
          JSON.parse(
            Buffer.from(value.split(".")[1] || "", "base64url").toString(),
          ).role === "anon"
        );
      } catch {
        return false;
      }
    }, "Use a Supabase publishable/anon key here, never a secret/service-role key")
    .optional(),
);
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1024).max(65535).default(8787),
  WEB_URL: z.url().default("http://127.0.0.1:5173"),
  API_URL: z.url().default("http://127.0.0.1:8787"),
  APP_SECRET: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(32).optional(),
  ),
  TOKEN_ENCRYPTION_KEY: optional,
  DATABASE_URL: optional,
  DATABASE_SSL: bool,
  SUPABASE_URL: optional,
  SUPABASE_PUBLISHABLE_KEY: publicKey,
  SUPABASE_SECRET_KEY: optional,
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  GOOGLE_REDIRECT_URI: z
    .url()
    .default("http://127.0.0.1:8787/oauth/google/callback"),
  GOOGLE_DRIVE_READ_ALL: bool,
  GOOGLE_DRIVE_PARENT_ID: optional,
  GOOGLE_CALENDAR_ID: z.string().default("primary"),
  GMAIL_INGESTION_MODE: z.enum(["poll", "push", "manual"]).default("poll"),
  GMAIL_POLL_SECONDS: z.coerce.number().min(30).default(120),
  GMAIL_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  GOOGLE_PUBSUB_TOPIC: optional,
  GOOGLE_PUBSUB_AUDIENCE: optional,
  GOOGLE_PUBSUB_SERVICE_ACCOUNT: optional,
  ENABLE_WORKERS: bool,
  CREATOR_AUTH_USER_ID: optional,
  CREATOR_EMAIL: optional,
  CREATOR_SLACK_USER_ID: optional,
  CREATOR_SWITCH_SENDER_ID: optional,
  SLACK_CLIENT_ID: optional,
  SLACK_CLIENT_SECRET: optional,
  SLACK_APP_TOKEN: optional,
  SLACK_REDIRECT_URI: z
    .url()
    .default("http://127.0.0.1:8787/oauth/slack/callback"),
  SLACK_WORKSPACE_ID: optional,
  SLACK_CHANNEL_ID: optional,
  SLACK_BOT_TOKEN: optional,
  SWITCH_BASE_URL: z.url().default("http://127.0.0.1:18000"),
  SWITCH_ROOM_ID: optional,
  SWITCH_REGISTRATION_KEY: optional,
  SWITCH_GATEWAY_EMAIL: optional,
  SWITCH_GATEWAY_PASSWORD: optional,
  SWITCH_TALENT_ID: optional,
  SWITCH_TALENT_KEY: optional,
  SWITCH_BRAND_ID: optional,
  SWITCH_BRAND_KEY: optional,
  SWITCH_CAMPAIGN_ID: optional,
  SWITCH_CAMPAIGN_KEY: optional,
  OPENCODE_BIN: z.string().default("opencode"),
  OPENCODE_MODEL: z.string().default("opencode/big-pickle"),
  LLM_PROVIDER: z.enum(["opencode"]).default("opencode"),
  AGENT_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(900).default(240),
  MAX_AGENT_TOOL_CALLS: z.coerce.number().int().min(1).max(100).default(40),
  MAX_TASK_HOPS: z.coerce.number().int().min(1).max(12).default(6),
  APPROVAL_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(24),
  MAX_ATTACHMENT_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(25000000)
    .default(10000000),
});
export const config = schema.parse(process.env);
export function required<K extends keyof typeof config>(
  key: K,
): NonNullable<(typeof config)[K]> {
  const value = config[key];
  if (value === undefined || value === "")
    throw new AppError(503, `${key} is not configured`);
  return value as NonNullable<(typeof config)[K]>;
}
export function readiness() {
  return {
    database: !!config.DATABASE_URL,
    authentication: !!(config.SUPABASE_URL && config.SUPABASE_PUBLISHABLE_KEY),
    encryption: !!config.TOKEN_ENCRYPTION_KEY,
    google: !!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
    switch: !!(
      config.SWITCH_REGISTRATION_KEY ||
      (config.SWITCH_ROOM_ID &&
        config.SWITCH_TALENT_ID &&
        config.SWITCH_TALENT_KEY &&
        config.SWITCH_BRAND_ID &&
        config.SWITCH_BRAND_KEY &&
        config.SWITCH_CAMPAIGN_ID &&
        config.SWITCH_CAMPAIGN_KEY)
    ),
    creator: !!(config.CREATOR_AUTH_USER_ID || config.CREATOR_EMAIL),
    workers: config.ENABLE_WORKERS,
  };
}
export const googleScopes = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar.events",
  ...(config.GOOGLE_DRIVE_READ_ALL
    ? ["https://www.googleapis.com/auth/drive.readonly"]
    : []),
];
