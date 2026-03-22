import { getAddress, isAddress } from "viem";
import { prisma } from "../db/prisma";
import { env } from "../config/env";
import { InProcessSnapshotRefresher } from "./analytics-interfaces";
import {
  DefaultRangeStrategyEngine,
  GuardedAutoCompoundExecutionPolicy,
  GuardedRebalanceExecutionPolicy,
  InProcessStrategyEvaluationWorker,
  PrismaPoolMarketSnapshotStore,
  QueueBackedAutoCompoundExecutor,
  QueueBackedRebalanceExecutor,
  buildAutoCompoundTxRequest,
  buildRebalanceTxRequest
} from "./strategy";

export const automationStrategyWorker = new InProcessStrategyEvaluationWorker(
  new DefaultRangeStrategyEngine(),
  new PrismaPoolMarketSnapshotStore(),
  {
    executionPolicy: new GuardedRebalanceExecutionPolicy({
      allowExecution: env.AUTOMATION_EXECUTION_ENABLED,
      minimumNetBenefitUsd: env.AUTOMATION_MIN_NET_BENEFIT_USD
    }),
    autoCompoundExecutionPolicy: new GuardedAutoCompoundExecutionPolicy({
      allowExecution: env.AUTOMATION_AUTO_COMPOUND_ENABLED,
      minimumFeesUsd: env.AUTOMATION_MIN_COMPOUND_FEES_USD
    }),
    executor: new QueueBackedRebalanceExecutor({
      workerId: "strategy-rebalance-worker",
      priority: 80,
      txRequestBuilder: buildRebalanceTxRequest
    }),
    autoCompoundExecutor: new QueueBackedAutoCompoundExecutor({
      workerId: "strategy-compound-worker",
      priority: 90,
      txRequestBuilder: buildAutoCompoundTxRequest
    })
  }
);

export async function listAutoManagedWallets(limit = 100): Promise<`0x${string}`[]> {
  const rows = await prisma.$queryRaw<Array<{ wallet: string }>>`
    SELECT DISTINCT "wallet"
    FROM "AutomationPolicy"
    WHERE "enabled" = true
      AND ("autoRebalanceEnabled" = true OR "autoCompoundEnabled" = true)
    ORDER BY "wallet" ASC
    LIMIT ${Math.min(Math.max(limit, 1), 1000)};
  `;
  const out: `0x${string}`[] = [];
  for (const row of rows) {
    const normalized = row.wallet.toLowerCase();
    if (!isAddress(normalized)) continue;
    out.push(getAddress(normalized));
  }
  return out;
}

const snapshotRefresher = new InProcessSnapshotRefresher();

export async function evaluateAutoManagedWallets(limit = 100): Promise<{
  attempted: number;
  completed: number;
  failed: number;
  wallets: `0x${string}`[];
}> {
  const wallets = await listAutoManagedWallets(limit);
  let completed = 0;
  let failed = 0;
  for (const wallet of wallets) {
    try {
      if (env.AUTOMATION_DAEMON_SNAPSHOT_REFRESH_BEFORE_EVALUATE) {
        await snapshotRefresher.refreshPositionSnapshots({ wallet });
      }
      await automationStrategyWorker.evaluateWallet({ wallet });
      completed += 1;
    } catch (error) {
      failed += 1;
      console.error(
        JSON.stringify({
          event: "automation_autopilot_wallet_evaluate_failed",
          wallet,
          error: error instanceof Error ? error.message : "unknown_error"
        })
      );
    }
  }
  return {
    attempted: wallets.length,
    completed,
    failed,
    wallets
  };
}

