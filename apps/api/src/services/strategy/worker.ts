import { randomUUID } from "crypto";
import { getAddress, isAddress } from "viem";
import { prisma } from "../../db/prisma";
import { env } from "../../config/env";
import { PositionAnalyticsEngine } from "../position-analytics";
import { DefaultPositionLiveStateLoader, type PositionLiveStateLoader } from "../positions-live";
import { ChainlinkPriceProvider, CompositeTokenPriceProvider, StaticStablecoinPriceProvider } from "../token-price";
import { enqueueAutomationJob } from "../automation-queue";
import { executeAutomationJobById, listAutomationExecutions } from "../automation-executor";
import type { AutomationTxRequest } from "../automation-tx-relayer";
import type { RangeStrategyEngine } from "./strategy-engine";
import type { PoolMarketSnapshotStore } from "./stores";
import type { PositionStrategyContext, StrategyMode } from "./types";

export interface StrategyEvaluationWorker {
  evaluateWallet(input: { wallet: `0x${string}`; mode?: StrategyMode }): Promise<void>;
}

export interface AutoRebalanceScheduler {
  scheduleEvaluation(input: { wallet: `0x${string}`; atMs?: number; mode?: StrategyMode }): Promise<void>;
}

export interface RebalanceExecutionPolicy {
  canExecute(input: { wallet: `0x${string}`; positionId: string; shouldRebalance: boolean; netExpectedBenefitUsd: number }): boolean;
}

export interface AutoCompoundExecutionPolicy {
  canExecute(input: { wallet: `0x${string}`; positionId: string; estimatedFeesUsd: number | null }): boolean;
}

export interface RebalanceExecutor {
  execute(input: {
    wallet: `0x${string}`;
    positionId: string;
    chainId: number;
    currentTickLower: number;
    currentTickUpper: number;
    proposedTickLower: number;
    proposedTickUpper: number;
    slippageBps?: number;
    deadlineSeconds?: number;
  }): Promise<{
    txHash?: `0x${string}`;
    newPositionId?: string;
    note?: string;
  }>;
}

export interface AutoCompoundExecutor {
  execute(input: {
    wallet: `0x${string}`;
    positionId: string;
    chainId: number;
    estimatedFeesUsd: number | null;
    slippageBps?: number;
    deadlineSeconds?: number;
  }): Promise<{
    txHash?: `0x${string}`;
    note?: string;
  }>;
}

export interface WorkerActivityLogger {
  log(input: {
    wallet: `0x${string}`;
    positionId: string;
    type: "Rebalance" | "Collect" | "Snapshot refreshed" | "Error";
    message: string;
    tx?: string;
  }): Promise<void>;
}

type WorkerPositionRow = {
  positionId: string;
  chainId: number;
  poolAddress: `0x${string}`;
  token0Address: `0x${string}`;
  token1Address: `0x${string}`;
  token0Symbol: string;
  token1Symbol: string;
  feeTier: number;
  tickLower: number;
  tickUpper: number;
  createdAt: Date;
  status: "IN_RANGE" | "OUT_OF_RANGE" | "CLOSED";
};

type EffectiveAutomationPolicy = {
  enabled: boolean;
  mode: StrategyMode;
  minNetBenefitUsd: number;
  autoRebalanceEnabled: boolean;
  autoCompoundEnabled: boolean;
  maxSlippageBps: number;
};

export class DryRunRebalanceExecutionPolicy implements RebalanceExecutionPolicy {
  canExecute(input: { wallet: `0x${string}`; positionId: string; shouldRebalance: boolean; netExpectedBenefitUsd: number }): boolean {
    // Dry-run only: keep automation safe by default.
    return input.shouldRebalance && input.netExpectedBenefitUsd > 0 && false;
  }
}

export class GuardedRebalanceExecutionPolicy implements RebalanceExecutionPolicy {
  constructor(
    private readonly options: {
      allowExecution: boolean;
      minimumNetBenefitUsd?: number;
    } = {
      allowExecution: false,
      minimumNetBenefitUsd: 0
    }
  ) {}

  canExecute(input: {
    wallet: `0x${string}`;
    positionId: string;
    shouldRebalance: boolean;
    netExpectedBenefitUsd: number;
  }): boolean {
    if (!this.options.allowExecution) return false;
    if (!input.shouldRebalance) return false;
    const minimum = this.options.minimumNetBenefitUsd ?? 0;
    return input.netExpectedBenefitUsd >= minimum;
  }
}

export class DryRunAutoCompoundExecutionPolicy implements AutoCompoundExecutionPolicy {
  canExecute(_input: { wallet: `0x${string}`; positionId: string; estimatedFeesUsd: number | null }): boolean {
    // Dry-run only: keep automation safe by default.
    return false;
  }
}

export class GuardedAutoCompoundExecutionPolicy implements AutoCompoundExecutionPolicy {
  constructor(
    private readonly options: {
      allowExecution: boolean;
      minimumFeesUsd?: number;
    } = {
      allowExecution: false,
      minimumFeesUsd: 0
    }
  ) {}

  canExecute(input: { wallet: `0x${string}`; positionId: string; estimatedFeesUsd: number | null }): boolean {
    if (!this.options.allowExecution) return false;
    if (input.estimatedFeesUsd == null || input.estimatedFeesUsd <= 0) return false;
    const minimum = this.options.minimumFeesUsd ?? 0;
    return input.estimatedFeesUsd >= minimum;
  }
}

class PrismaWorkerActivityLogger implements WorkerActivityLogger {
  async log(input: {
    wallet: `0x${string}`;
    positionId: string;
    type: "Rebalance" | "Collect" | "Snapshot refreshed" | "Error";
    message: string;
    tx?: string;
  }): Promise<void> {
    await prisma.activityLog.create({
      data: {
        wallet: input.wallet.toLowerCase(),
        positionId: input.positionId,
        type: input.type,
        source: "worker",
        tx: input.tx ?? null,
        message: input.message
      } as any
    });
  }
}

function toTxHash(value: string | null | undefined): `0x${string}` | undefined {
  if (typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value)) {
    return value as `0x${string}`;
  }
  return undefined;
}

type RebalanceTxRequestBuilder = (input: {
  wallet: `0x${string}`;
  positionId: string;
  chainId: number;
  currentTickLower: number;
  currentTickUpper: number;
  proposedTickLower: number;
  proposedTickUpper: number;
}) => AutomationTxRequest | null;

type AutoCompoundTxRequestBuilder = (input: {
  wallet: `0x${string}`;
  positionId: string;
  chainId: number;
  estimatedFeesUsd: number | null;
}) => AutomationTxRequest | null;

export class QueueBackedRebalanceExecutor implements RebalanceExecutor {
  constructor(
    private readonly options: {
      workerId?: string;
      priority?: number;
      txRequestBuilder?: RebalanceTxRequestBuilder;
    } = {}
  ) {}

  async execute(input: {
    wallet: `0x${string}`;
    positionId: string;
    chainId: number;
    currentTickLower: number;
    currentTickUpper: number;
    proposedTickLower: number;
    proposedTickUpper: number;
  }): Promise<{
    txHash?: `0x${string}`;
    newPositionId?: string;
    note?: string;
  }> {
    const payload: Record<string, unknown> = {
      strategyAction: "rebalance",
      source: "strategy-worker",
      currentTickLower: input.currentTickLower,
      currentTickUpper: input.currentTickUpper,
      proposedTickLower: input.proposedTickLower,
      proposedTickUpper: input.proposedTickUpper
    };
    const txRequest = this.options.txRequestBuilder?.(input) ?? null;
    if (txRequest) {
      payload.txRequest = txRequest;
    }
    const job = await enqueueAutomationJob({
      wallet: input.wallet,
      positionId: input.positionId,
      chainId: input.chainId,
      type: "REBALANCE",
      idempotencyKey: `worker-rebalance-${input.wallet.toLowerCase()}-${input.positionId}-${Date.now()}-${randomUUID()}`,
      priority: this.options.priority ?? 80,
      payload
    });
    const run = await executeAutomationJobById(job.id, {
      workerId: this.options.workerId ?? "strategy-rebalance-worker"
    });
    if (!run.ok && !("skipped" in run && run.skipped)) {
      throw new Error(run.error);
    }
    const rows = await listAutomationExecutions({ jobId: job.id, limit: 1 });
    const latest = rows[0];
    return {
      txHash: toTxHash(latest?.txHash ?? null),
      note: latest
        ? `job=${job.id},status=${latest.status},txStatus=${latest.txStatus ?? "n/a"}`
        : `job=${job.id},status=queued`
    };
  }
}

export class QueueBackedAutoCompoundExecutor implements AutoCompoundExecutor {
  constructor(
    private readonly options: {
      workerId?: string;
      priority?: number;
      txRequestBuilder?: AutoCompoundTxRequestBuilder;
    } = {}
  ) {}

  async execute(input: {
    wallet: `0x${string}`;
    positionId: string;
    chainId: number;
    estimatedFeesUsd: number | null;
  }): Promise<{
    txHash?: `0x${string}`;
    note?: string;
  }> {
    const payload: Record<string, unknown> = {
      strategyAction: "auto_compound",
      source: "strategy-worker",
      estimatedFeesUsd: input.estimatedFeesUsd
    };
    const txRequest = this.options.txRequestBuilder?.(input) ?? null;
    if (txRequest) {
      payload.txRequest = txRequest;
    }
    const job = await enqueueAutomationJob({
      wallet: input.wallet,
      positionId: input.positionId,
      chainId: input.chainId,
      type: "COMPOUND",
      idempotencyKey: `worker-compound-${input.wallet.toLowerCase()}-${input.positionId}-${Date.now()}-${randomUUID()}`,
      priority: this.options.priority ?? 90,
      payload
    });
    const run = await executeAutomationJobById(job.id, {
      workerId: this.options.workerId ?? "strategy-compound-worker"
    });
    if (!run.ok && !("skipped" in run && run.skipped)) {
      throw new Error(run.error);
    }
    const rows = await listAutomationExecutions({ jobId: job.id, limit: 1 });
    const latest = rows[0];
    return {
      txHash: toTxHash(latest?.txHash ?? null),
      note: latest
        ? `job=${job.id},status=${latest.status},txStatus=${latest.txStatus ?? "n/a"}`
        : `job=${job.id},status=queued`
    };
  }
}

export class InProcessStrategyEvaluationWorker implements StrategyEvaluationWorker {
  private readonly liveStateLoader: PositionLiveStateLoader;
  private readonly analyticsEngine: PositionAnalyticsEngine;
  private readonly rebalanceExecutionPolicy: RebalanceExecutionPolicy;
  private readonly autoCompoundExecutionPolicy: AutoCompoundExecutionPolicy;
  private readonly activityLogger: WorkerActivityLogger;
  private readonly rebalanceExecutor: RebalanceExecutor | null;
  private readonly autoCompoundExecutor: AutoCompoundExecutor | null;
  private readonly logger: (entry: Record<string, unknown>) => void;
  private readonly loadPositions: (wallet: `0x${string}`) => Promise<WorkerPositionRow[]>;
  private readonly loadPolicies: (wallet: `0x${string}`) => Promise<Map<string, EffectiveAutomationPolicy>>;

  constructor(
    private readonly strategyEngine: RangeStrategyEngine,
    private readonly snapshotStore: PoolMarketSnapshotStore,
    options: {
      liveStateLoader?: PositionLiveStateLoader;
      analyticsEngine?: PositionAnalyticsEngine;
      executionPolicy?: RebalanceExecutionPolicy;
      autoCompoundExecutionPolicy?: AutoCompoundExecutionPolicy;
      activityLogger?: WorkerActivityLogger;
      executor?: RebalanceExecutor | null;
      autoCompoundExecutor?: AutoCompoundExecutor | null;
      logger?: (entry: Record<string, unknown>) => void;
      loadPositions?: (wallet: `0x${string}`) => Promise<WorkerPositionRow[]>;
      loadPolicies?: (wallet: `0x${string}`) => Promise<Map<string, EffectiveAutomationPolicy>>;
    } = {}
  ) {
    this.liveStateLoader = options.liveStateLoader ?? new DefaultPositionLiveStateLoader();
    this.analyticsEngine =
      options.analyticsEngine ??
      new PositionAnalyticsEngine(new CompositeTokenPriceProvider([new StaticStablecoinPriceProvider(), new ChainlinkPriceProvider()]));
    this.rebalanceExecutionPolicy = options.executionPolicy ?? new DryRunRebalanceExecutionPolicy();
    this.autoCompoundExecutionPolicy = options.autoCompoundExecutionPolicy ?? new DryRunAutoCompoundExecutionPolicy();
    this.activityLogger = options.activityLogger ?? new PrismaWorkerActivityLogger();
    this.rebalanceExecutor = options.executor ?? null;
    this.autoCompoundExecutor = options.autoCompoundExecutor ?? null;
    this.logger = options.logger ?? ((entry) => console.info(JSON.stringify(entry)));
    this.loadPositions = options.loadPositions ?? loadWorkerPositionsFromDb;
    this.loadPolicies = options.loadPolicies ?? loadAutomationPoliciesByWallet;
  }

  async evaluateWallet(input: { wallet: `0x${string}`; mode?: StrategyMode }): Promise<void> {
    if (!isAddress(input.wallet)) {
      throw new Error("Invalid wallet address");
    }
    const wallet = getAddress(input.wallet);
    const mode = input.mode ?? "BALANCED";
    const startedAt = Date.now();
    const positions = await this.loadPositions(wallet);
    const policyMap = await this.loadPolicies(wallet);
    if (positions.length === 0) {
      this.logger({
        event: "strategy_worker_no_positions",
        wallet,
        mode
      });
      return;
    }

    const liveBundle = await this.liveStateLoader.enrich(
      positions.map((row) => ({
        positionId: row.positionId,
        chainId: row.chainId,
        poolAddress: row.poolAddress,
        token0Address: row.token0Address,
        token1Address: row.token1Address,
        tickLower: row.tickLower,
        tickUpper: row.tickUpper,
        savedStatus: row.status
      }))
    );

    for (const row of positions) {
      try {
        const policy = policyMap.get(row.positionId) ?? policyMap.get("*");
        if (!policy || !policy.enabled) {
          await this.activityLogger.log({
            wallet,
            positionId: row.positionId,
            type: "Snapshot refreshed",
            message: "Worker evaluation skipped (policy disabled or missing)."
          });
          continue;
        }
        const live = liveBundle.byPositionId.get(row.positionId);
        if (!live) {
          await this.activityLogger.log({
            wallet,
            positionId: row.positionId,
            type: "Error",
            message: "Worker could not load live state for position."
          });
          continue;
        }
        await this.snapshotStore.saveSnapshot({
          chainId: row.chainId,
          poolAddress: row.poolAddress,
          currentTick: live.currentTick,
          currentPrice: live.currentPrice,
          liquidity: live.liquidity
        });
        const recentSnapshots = await this.snapshotStore.getRecentSnapshots({
          chainId: row.chainId,
          poolAddress: row.poolAddress,
          limit: 64
        });
        const analytics = await this.analyticsEngine.analyze({
          saved: {
            positionId: row.positionId,
            chainId: row.chainId,
            feeTier: row.feeTier,
            poolAddress: row.poolAddress,
            token0Address: row.token0Address,
            token1Address: row.token1Address,
            token0Symbol: row.token0Symbol,
            token1Symbol: row.token1Symbol,
            tickLower: row.tickLower,
            tickUpper: row.tickUpper,
            createdAt: row.createdAt.toISOString(),
            savedStatus: row.status
          },
          live: {
            currentTick: live.currentTick,
            currentPrice: live.currentPrice,
            sqrtPriceX96: live.sqrtPriceX96,
            liquidity: live.liquidity,
            snapshotUpdatedAt: live.snapshotUpdatedAt,
            stale: live.stale,
            source: live.liveStateSource
          }
        });
        const context: PositionStrategyContext = {
          wallet,
          positionId: row.positionId,
          chainId: row.chainId,
          poolAddress: row.poolAddress,
          feeTier: row.feeTier,
          tickLower: row.tickLower,
          tickUpper: row.tickUpper,
          currentTick: live.currentTick,
          currentPrice: live.currentPrice,
          createdAt: row.createdAt.toISOString(),
          token0Symbol: row.token0Symbol,
          token1Symbol: row.token1Symbol,
          analytics: {
            estimatedFeesUsd: analytics.analytics.feeState.estimatedUncollectedFeesUsd,
            estimatedApr: analytics.analytics.estimatedApr,
            estimatedImpermanentLossUsd: analytics.analytics.estimatedImpermanentLossUsd,
            estimatedPositionValueUsd: analytics.analytics.estimatedPositionValueUsd,
            metricQuality:
              analytics.analytics.status === "exact"
                ? "exact"
                : analytics.analytics.status === "estimated"
                  ? "estimated"
                  : "heuristic"
          },
          estimatedGasCostUsd: 8
        };
        const recommendation = this.strategyEngine.evaluate({
          mode: policy.mode ?? mode,
          context,
          recentSnapshots
        });
        const canRebalance = this.rebalanceExecutionPolicy.canExecute({
          wallet,
          positionId: row.positionId,
          shouldRebalance:
            policy.autoRebalanceEnabled &&
            recommendation.decision.shouldRebalance &&
            recommendation.decision.netExpectedBenefitUsd >= policy.minNetBenefitUsd,
          netExpectedBenefitUsd: recommendation.decision.netExpectedBenefitUsd
        });

        if (canRebalance && this.rebalanceExecutor) {
          const execution = await this.rebalanceExecutor.execute({
            wallet,
            positionId: row.positionId,
            chainId: row.chainId,
            currentTickLower: row.tickLower,
            currentTickUpper: row.tickUpper,
            proposedTickLower: recommendation.proposal.suggestedTickLower,
            proposedTickUpper: recommendation.proposal.suggestedTickUpper,
            slippageBps: policy.maxSlippageBps,
            deadlineSeconds: env.TX_DEADLINE_SECONDS
          });
          await this.activityLogger.log({
            wallet,
            positionId: row.positionId,
            type: "Rebalance",
            tx: execution.txHash,
            message: `Worker executed rebalance. oldRange=${row.tickLower}-${row.tickUpper}, newRange=${recommendation.proposal.suggestedTickLower}-${recommendation.proposal.suggestedTickUpper}, newPositionId=${execution.newPositionId ?? "n/a"}`
          });
          continue;
        }

        const estimatedFeesUsd = analytics.analytics.feeState.estimatedUncollectedFeesUsd;
        const canAutoCompound = this.autoCompoundExecutionPolicy.canExecute({
          wallet,
          positionId: row.positionId,
          estimatedFeesUsd: policy.autoCompoundEnabled ? estimatedFeesUsd : null
        });

        if (canAutoCompound && this.autoCompoundExecutor) {
          const compoundExecution = await this.autoCompoundExecutor.execute({
            wallet,
            positionId: row.positionId,
            chainId: row.chainId,
            estimatedFeesUsd,
            slippageBps: policy.maxSlippageBps,
            deadlineSeconds: env.TX_DEADLINE_SECONDS
          });
          await this.activityLogger.log({
            wallet,
            positionId: row.positionId,
            type: "Collect",
            tx: compoundExecution.txHash,
            message: `Worker executed auto-compound candidate. estimatedFeesUsd=${estimatedFeesUsd ?? "n/a"}`
          });
          continue;
        }

        await this.activityLogger.log({
          wallet,
          positionId: row.positionId,
          type: "Snapshot refreshed",
          message: `Worker evaluation: mode=${policy.mode ?? mode}, shouldRebalance=${recommendation.decision.shouldRebalance}, net=${recommendation.decision.netExpectedBenefitUsd.toFixed(2)}, rebalancePolicy=${policy.autoRebalanceEnabled}, autoCompoundPolicy=${policy.autoCompoundEnabled}, rebalance=${canRebalance && this.rebalanceExecutor ? "enabled" : "skipped"}, autoCompound=${canAutoCompound && this.autoCompoundExecutor ? "enabled" : "skipped"}, fees=${estimatedFeesUsd ?? "n/a"}`
        });
      } catch (error) {
        await this.activityLogger.log({
          wallet,
          positionId: row.positionId,
          type: "Error",
          message: `Worker execution error: ${error instanceof Error ? error.message : "unknown error"}`
        });
      }
    }
    this.logger({
      event: "strategy_worker_wallet_completed",
      wallet,
      mode,
      positions: positions.length,
      liveFetches: liveBundle.stats.livePoolFetches,
      fallbackCount: liveBundle.stats.fallbackCount,
      elapsedMs: Date.now() - startedAt
    });
  }
}

export class InProcessAutoRebalanceScheduler implements AutoRebalanceScheduler {
  constructor(private readonly worker: StrategyEvaluationWorker) {}
  async scheduleEvaluation(input: { wallet: `0x${string}`; atMs?: number; mode?: StrategyMode }): Promise<void> {
    if (!input.atMs || input.atMs <= Date.now()) {
      await this.worker.evaluateWallet({ wallet: input.wallet, mode: input.mode });
      return;
    }
    const delayMs = Math.max(0, input.atMs - Date.now());
    setTimeout(() => {
      void this.worker.evaluateWallet({ wallet: input.wallet, mode: input.mode });
    }, delayMs);
  }
}

export function buildStrategyPreviewFromWorkerContext(
  _context: PositionStrategyContext
): { dryRun: true; note: string } {
  return {
    dryRun: true,
    note: "Worker can execute when guarded policy allows it and executors are configured."
  };
}

async function loadWorkerPositionsFromDb(wallet: `0x${string}`): Promise<WorkerPositionRow[]> {
  const rows = await prisma.position.findMany({
    where: { wallet: wallet.toLowerCase() },
    orderBy: { createdAt: "desc" },
    select: {
      positionId: true,
      chainId: true,
      poolAddress: true,
      token0Address: true,
      token1Address: true,
      token0Symbol: true,
      token1Symbol: true,
      feeTier: true,
      tickLower: true,
      tickUpper: true,
      createdAt: true,
      status: true
    },
    take: 200
  });
  return rows.map((row) => ({
    ...row,
    poolAddress: row.poolAddress as `0x${string}`,
    token0Address: row.token0Address as `0x${string}`,
    token1Address: row.token1Address as `0x${string}`
  }));
}

async function loadAutomationPoliciesByWallet(wallet: `0x${string}`): Promise<Map<string, EffectiveAutomationPolicy>> {
  const rows = await prisma.$queryRaw<
    Array<{
      positionId: string | null;
      enabled: boolean;
      mode: StrategyMode;
      minNetBenefitUsd: number;
      autoRebalanceEnabled: boolean;
      autoCompoundEnabled: boolean;
      maxSlippageBps: number;
      updatedAt: Date;
    }>
  >`
    SELECT
      "positionId",
      "enabled",
      "mode",
      "minNetBenefitUsd",
      "autoRebalanceEnabled",
      "autoCompoundEnabled",
      COALESCE("maxSlippageBps", ${env.DEFAULT_SLIPPAGE_BPS})::int as "maxSlippageBps",
      "updatedAt"
    FROM "AutomationPolicy"
    WHERE "wallet" = ${wallet.toLowerCase()}
    ORDER BY "updatedAt" DESC;
  `;
  const map = new Map<string, EffectiveAutomationPolicy>();
  for (const row of rows) {
    const key = row.positionId ?? "*";
    if (map.has(key)) continue;
    map.set(key, {
      enabled: row.enabled,
      mode: row.mode,
      minNetBenefitUsd: Number(row.minNetBenefitUsd ?? 0),
      autoRebalanceEnabled: row.autoRebalanceEnabled,
      autoCompoundEnabled: row.autoCompoundEnabled,
      maxSlippageBps: Math.min(env.MAX_SLIPPAGE_BPS, Math.max(1, row.maxSlippageBps ?? env.DEFAULT_SLIPPAGE_BPS))
    });
  }
  return map;
}
