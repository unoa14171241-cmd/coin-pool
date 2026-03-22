import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  ALLOWED_CHAIN_IDS: z.string().default("42161,1,8453,137"),
  MAX_SLIPPAGE_BPS: z.coerce.number().min(1).max(500).default(100),
  /** デフォルトslippage（bps）。ポジション未設定時はこれを使用。0.5%〜1% = 50〜100 */
  DEFAULT_SLIPPAGE_BPS: z.coerce.number().min(1).max(500).default(50),
  /** トランザクションdeadline（秒）。now + この値。envで変更可能 */
  TX_DEADLINE_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  CHALLENGE_TTL_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  CHALLENGE_STORE_BACKEND: z.enum(["memory", "redis"]).default("memory"),
  REDIS_URL: z.string().url().optional(),
  REDIS_SNAPSHOT_CACHE_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  AUTOMATION_EXECUTION_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  AUTOMATION_MIN_NET_BENEFIT_USD: z.coerce.number().min(0).default(5),
  AUTOMATION_AUTO_COMPOUND_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  AUTOMATION_MIN_COMPOUND_FEES_USD: z.coerce.number().min(0).default(10),
  AUTOMATION_DAEMON_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  AUTOMATION_DAEMON_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
  AUTOMATION_DAEMON_MAX_WALLETS_PER_TICK: z.coerce.number().int().positive().max(200).default(20),
  AUTOMATION_DAEMON_MAX_JOBS_PER_WALLET: z.coerce.number().int().positive().max(100).default(5),
  AUTOMATION_DAEMON_RETRY_FAILED_LIMIT: z.coerce.number().int().min(0).max(100).default(0),
  AUTOMATION_DAEMON_EVALUATE_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  AUTOMATION_DAEMON_EVALUATE_MAX_WALLETS: z.coerce.number().int().positive().max(1000).default(100),
  AUTOMATION_DAEMON_SNAPSHOT_REFRESH_BEFORE_EVALUATE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  AUTOMATION_RELAYER_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  AUTOMATION_RELAYER_URL: z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    z.string().url().optional()
  ),
  AUTOMATION_RELAYER_API_KEY: z.string().optional(),
  AUTOMATION_RELAYER_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  AUTOMATION_RELAYER_WAIT_CONFIRMATION: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  AUTOMATION_TX_CONFIRM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  AUTOMATION_AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  AUTOMATION_AUDIT_CLEANUP_INTERVAL_MS: z.coerce.number().int().positive().default(6 * 60 * 60 * 1000),
  AUTOMATION_AUDIT_CLEANUP_BATCH: z.coerce.number().int().positive().max(50_000).default(5000),
  AUTOMATION_EXECUTOR_ADDRESS_ARBITRUM: z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()
  ),
  AUTOMATION_EXECUTOR_ADDRESS_MAINNET: z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()
  ),
  AUTOMATION_EXECUTOR_ADDRESS_BASE: z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()
  ),
  AUTOMATION_EXECUTOR_ADDRESS_POLYGON: z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()
  ),
  ARBITRUM_RPC_URL: z.string().url().optional(),
  MAINNET_RPC_URL: z.string().url().optional(),
  BASE_RPC_URL: z.string().url().optional(),
  POLYGON_RPC_URL: z.string().url().optional(),
  PLATFORM_WALLET: z.preprocess(
    (v) => (typeof v === "string" && v.trim().length > 0 ? v : undefined),
    z
      .string({ required_error: "PLATFORM_WALLET is required. Set in .env (see .env.example)." })
      .regex(/^0x[a-fA-F0-9]{40}$/, "PLATFORM_WALLET must be a valid EVM address")
  ),
  /** Comma-separated admin wallets allowed to trigger daily distribution. PLATFORM_WALLET is always allowed (owner). */
  ADMIN_WALLETS: z.preprocess(
    (v) => (typeof v === "string" ? v : ""),
    z.string().transform((s) =>
      s
        .split(",")
        .map((a) => a.trim().toLowerCase())
        .filter((a) => /^0x[a-fA-F0-9]{40}$/.test(a))
    )
  ),
  DAILY_DISTRIBUTION_SCHEDULER_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  DAILY_DISTRIBUTION_SCHEDULER_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(0),
  DAILY_DISTRIBUTION_SCHEDULER_MINUTE_UTC: z.coerce.number().int().min(0).max(59).default(0),
  DAILY_DISTRIBUTION_CHECK_INTERVAL_MS: z.coerce.number().int().positive().default(60 * 60 * 1000),
  MAINNET_AUTO_EXECUTION_DISABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  MIN_POSITION_VALUE_USD: z.coerce.number().min(0).default(500)
});

export const env = envSchema.parse(process.env);

const SUPPORTED_CHAIN_IDS = new Set<number>([42161, 1, 8453, 137]);

const parsedAllowedChainIds = Array.from(
  new Set(
    env.ALLOWED_CHAIN_IDS.split(",")
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isInteger(id) && SUPPORTED_CHAIN_IDS.has(id))
  )
);

export const allowedChainIds = parsedAllowedChainIds.length > 0 ? parsedAllowedChainIds : Array.from(SUPPORTED_CHAIN_IDS);
