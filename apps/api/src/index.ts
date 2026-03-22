import express from "express";
import cors from "cors";
import { env } from "./config/env";
import positionsRouter from "./routes/positions";
import logsRouter from "./routes/logs";
import settingsRouter from "./routes/settings";
import marketRouter from "./routes/market";
import authRouter from "./routes/auth";
import syncRouter from "./routes/sync";
import automationRouter from "./routes/automation";
import profitRouter from "./routes/profit";
import strategiesRouter from "./routes/strategies";
import automationSettingsRouter from "./routes/automation-settings";
import auditV2Router from "./routes/audit-v2";
import { initializeChallengeStore } from "./auth/challenge-store";
import { getRouteOutcomeSummary, recordRouteOutcome } from "./services/observability/route-outcome-observability";
import { getAutomationDaemonState, startAutomationDaemon, stopAutomationDaemon } from "./services/automation-daemon";
import {
  startDailyDistributionScheduler,
  stopDailyDistributionScheduler,
  getDailyDistributionSchedulerState
} from "./services/daily-distribution-scheduler";
import { getAutomationRelayerState } from "./services/automation-tx-relayer";

async function bootstrap() {
  await initializeChallengeStore();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      const routePath = typeof req.route?.path === "string" ? req.route.path : req.path;
      const routeKey = `${req.method.toUpperCase()} ${routePath}`;
      recordRouteOutcome(routeKey, res.statusCode);
      if (res.statusCode >= 400) {
        const summary = getRouteOutcomeSummary(routeKey);
        console.warn(
          JSON.stringify({
            event: "route_http_outcome",
            routeKey,
            statusCode: res.statusCode,
            elapsedMs: Date.now() - startedAt,
            ...summary
          })
        );
      }
    });
    next();
  });

  app.get("/", (_req, res) => {
    res.json({
      service: "lp-manager-api",
      status: "running",
      health: "/health",
      docs: "See API documentation for available endpoints."
    });
  });

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "lp-manager-api",
      challengeStoreBackend: env.CHALLENGE_STORE_BACKEND,
      challengeTtlMs: env.CHALLENGE_TTL_MS,
      redisSnapshotCacheEnabled: env.REDIS_SNAPSHOT_CACHE_ENABLED,
      automationExecutionEnabled: env.AUTOMATION_EXECUTION_ENABLED,
      automationMinNetBenefitUsd: env.AUTOMATION_MIN_NET_BENEFIT_USD,
      automationAutoCompoundEnabled: env.AUTOMATION_AUTO_COMPOUND_ENABLED,
      automationMinCompoundFeesUsd: env.AUTOMATION_MIN_COMPOUND_FEES_USD,
      automationDaemonEvaluateEnabled: env.AUTOMATION_DAEMON_EVALUATE_ENABLED,
      automationDaemonEvaluateMaxWallets: env.AUTOMATION_DAEMON_EVALUATE_MAX_WALLETS,
      automationRelayer: getAutomationRelayerState(),
      automationDaemon: getAutomationDaemonState(),
      dailyDistributionScheduler: getDailyDistributionSchedulerState()
    });
  });

  app.use(positionsRouter);
  app.use(logsRouter);
  app.use(settingsRouter);
  app.use(marketRouter);
  app.use(authRouter);
  app.use(syncRouter);
  app.use(automationRouter);
  app.use(profitRouter);
  app.use(strategiesRouter);
  app.use(automationSettingsRouter);
  app.use(auditV2Router);

  startAutomationDaemon({
    enabled: env.AUTOMATION_DAEMON_ENABLED,
    intervalMs: env.AUTOMATION_DAEMON_INTERVAL_MS,
    maxWalletsPerTick: env.AUTOMATION_DAEMON_MAX_WALLETS_PER_TICK,
    maxJobsPerWallet: env.AUTOMATION_DAEMON_MAX_JOBS_PER_WALLET,
    retryFailedLimit: env.AUTOMATION_DAEMON_RETRY_FAILED_LIMIT
  });

  startDailyDistributionScheduler();

  app.listen(env.PORT, "0.0.0.0", () => {
    // eslint-disable-next-line no-console
    console.log(`API running on http://0.0.0.0:${env.PORT}`);
  });
}

bootstrap().catch((error) => {
  stopAutomationDaemon();
  stopDailyDistributionScheduler();
  // eslint-disable-next-line no-console
  console.error("Failed to bootstrap API:", error);
  process.exit(1);
});
