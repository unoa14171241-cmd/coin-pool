import { describe, expect, it, vi } from "vitest";
import {
  GuardedAutoCompoundExecutionPolicy,
  GuardedRebalanceExecutionPolicy,
  InProcessStrategyEvaluationWorker,
  type AutoCompoundExecutor,
  type RebalanceExecutor,
  type WorkerActivityLogger
} from "../src/services/strategy/worker";

const WALLET = "0x1111111111111111111111111111111111111111" as const;

function buildPosition(positionId: string) {
  return {
    positionId,
    chainId: 42161,
    poolAddress: "0x2222222222222222222222222222222222222222" as const,
    token0Address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const,
    token1Address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const,
    token0Symbol: "WETH",
    token1Symbol: "USDC",
    feeTier: 500,
    tickLower: -120,
    tickUpper: 120,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    status: "IN_RANGE" as const
  };
}

function buildLoadPolicies() {
  return async () =>
    new Map([
      [
        "*",
        {
          enabled: true,
          mode: "BALANCED" as const,
          minNetBenefitUsd: 5,
          autoRebalanceEnabled: true,
          autoCompoundEnabled: true
        }
      ]
    ]);
}

function buildRecommendation(input: { shouldRebalance: boolean; netExpectedBenefitUsd: number }) {
  return {
    status: input.shouldRebalance ? "ok" : "hold",
    mode: "BALANCED",
    market: {
      marketState: "RANGE",
      confidence: 0.8,
      volatility: 0.2,
      trendScore: 0.1,
      drift: 0.1,
      explanationLines: []
    },
    proposal: {
      suggestedCenterPrice: 3000,
      suggestedLowerPrice: 2800,
      suggestedUpperPrice: 3200,
      suggestedTickLower: -100,
      suggestedTickUpper: 100,
      widthPercent: 10,
      confidence: 0.8,
      rationale: "test",
      explanationLines: []
    },
    decision: {
      shouldRebalance: input.shouldRebalance,
      urgency: "MEDIUM",
      reasonCodes: [],
      expectedBenefitUsd: 20,
      estimatedGasCostUsd: 8,
      netExpectedBenefitUsd: input.netExpectedBenefitUsd,
      explanationLines: []
    },
    rationale: "test",
    explanationLines: [],
    riskNotes: [],
    confidence: 0.8,
    computedAt: new Date().toISOString(),
    quality: {
      marketState: "heuristic",
      proposal: "heuristic",
      decision: "heuristic"
    }
  } as const;
}

describe("InProcessStrategyEvaluationWorker", () => {
  it("executes rebalance when guarded policy allows execution", async () => {
    const strategyEngine = {
      evaluate: vi.fn().mockReturnValue(buildRecommendation({ shouldRebalance: true, netExpectedBenefitUsd: 25 }))
    };
    const snapshotStore = {
      saveSnapshot: vi.fn().mockResolvedValue(undefined),
      getRecentSnapshots: vi.fn().mockResolvedValue([])
    };
    const liveStateLoader = {
      enrich: vi.fn().mockResolvedValue({
        byPositionId: new Map([
          [
            "p1",
            {
              currentTick: 10,
              currentPrice: 3000,
              computedStatus: "IN_RANGE",
              token1PerToken0: 3000,
              sqrtPriceX96: "1",
              liquidity: "1000",
              snapshotUpdatedAt: new Date().toISOString(),
              stale: false,
              liveStateSource: "rpc"
            }
          ]
        ]),
        stats: { livePoolFetches: 1, fallbackCount: 0 }
      })
    };
    const analyticsEngine = {
      analyze: vi.fn().mockResolvedValue({
        analytics: {
          status: "estimated",
          estimatedApr: 12,
          estimatedPositionValueUsd: 1000,
          estimatedImpermanentLossUsd: 10,
          feeState: { estimatedUncollectedFeesUsd: 4 }
        }
      })
    };
    const activityLogs: Array<{ type: string; message: string }> = [];
    const activityLogger: WorkerActivityLogger = {
      log: vi.fn(async (entry) => {
        activityLogs.push({ type: entry.type, message: entry.message });
      })
    };
    const executorCalls: Array<{ positionId: string }> = [];
    const executor: RebalanceExecutor = {
      execute: vi.fn(async (entry) => {
        executorCalls.push({ positionId: entry.positionId });
        return {
          txHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as `0x${string}`
        };
      })
    };
    const worker = new InProcessStrategyEvaluationWorker(strategyEngine as any, snapshotStore as any, {
      liveStateLoader: liveStateLoader as any,
      analyticsEngine: analyticsEngine as any,
      executionPolicy: new GuardedRebalanceExecutionPolicy({ allowExecution: true, minimumNetBenefitUsd: 5 }),
      activityLogger,
      executor,
      loadPositions: async () => [buildPosition("p1")],
      loadPolicies: buildLoadPolicies(),
      logger: () => undefined
    });

    await worker.evaluateWallet({ wallet: WALLET, mode: "BALANCED" });

    expect(executorCalls).toHaveLength(1);
    expect(executorCalls[0].positionId).toBe("p1");
    expect(activityLogs.some((item) => item.type === "Rebalance")).toBe(true);
  });

  it("keeps dry-run behavior when execution is disabled", async () => {
    const strategyEngine = {
      evaluate: vi.fn().mockReturnValue(buildRecommendation({ shouldRebalance: true, netExpectedBenefitUsd: 25 }))
    };
    const snapshotStore = {
      saveSnapshot: vi.fn().mockResolvedValue(undefined),
      getRecentSnapshots: vi.fn().mockResolvedValue([])
    };
    const liveStateLoader = {
      enrich: vi.fn().mockResolvedValue({
        byPositionId: new Map([
          [
            "p1",
            {
              currentTick: 10,
              currentPrice: 3000,
              computedStatus: "IN_RANGE",
              token1PerToken0: 3000,
              sqrtPriceX96: "1",
              liquidity: "1000",
              snapshotUpdatedAt: new Date().toISOString(),
              stale: false,
              liveStateSource: "rpc"
            }
          ]
        ]),
        stats: { livePoolFetches: 1, fallbackCount: 0 }
      })
    };
    const analyticsEngine = {
      analyze: vi.fn().mockResolvedValue({
        analytics: {
          status: "estimated",
          estimatedApr: 12,
          estimatedPositionValueUsd: 1000,
          estimatedImpermanentLossUsd: 10,
          feeState: { estimatedUncollectedFeesUsd: 4 }
        }
      })
    };
    const activityLogs: Array<{ type: string; message: string }> = [];
    const activityLogger: WorkerActivityLogger = {
      log: vi.fn(async (entry) => {
        activityLogs.push({ type: entry.type, message: entry.message });
      })
    };
    const worker = new InProcessStrategyEvaluationWorker(strategyEngine as any, snapshotStore as any, {
      liveStateLoader: liveStateLoader as any,
      analyticsEngine: analyticsEngine as any,
      executionPolicy: new GuardedRebalanceExecutionPolicy({ allowExecution: false }),
      activityLogger,
      executor: null,
      loadPositions: async () => [buildPosition("p1")],
      loadPolicies: buildLoadPolicies(),
      logger: () => undefined
    });

    await worker.evaluateWallet({ wallet: WALLET });

    expect(activityLogs.some((item) => item.type === "Snapshot refreshed")).toBe(true);
    expect(activityLogs.some((item) => item.type === "Rebalance")).toBe(false);
  });

  it("continues evaluating other positions even when one fails", async () => {
    const strategyEngine = {
      evaluate: vi.fn().mockImplementation((input: { context: { positionId: string } }) => {
        if (input.context.positionId === "p1") {
          throw new Error("failed to evaluate");
        }
        return buildRecommendation({ shouldRebalance: false, netExpectedBenefitUsd: -2 });
      })
    };
    const snapshotStore = {
      saveSnapshot: vi.fn().mockResolvedValue(undefined),
      getRecentSnapshots: vi.fn().mockResolvedValue([])
    };
    const liveStateLoader = {
      enrich: vi.fn().mockResolvedValue({
        byPositionId: new Map([
          [
            "p1",
            {
              currentTick: 10,
              currentPrice: 3000,
              computedStatus: "IN_RANGE",
              token1PerToken0: 3000,
              sqrtPriceX96: "1",
              liquidity: "1000",
              snapshotUpdatedAt: new Date().toISOString(),
              stale: false,
              liveStateSource: "rpc"
            }
          ],
          [
            "p2",
            {
              currentTick: 11,
              currentPrice: 2990,
              computedStatus: "IN_RANGE",
              token1PerToken0: 2990,
              sqrtPriceX96: "1",
              liquidity: "1000",
              snapshotUpdatedAt: new Date().toISOString(),
              stale: false,
              liveStateSource: "rpc"
            }
          ]
        ]),
        stats: { livePoolFetches: 2, fallbackCount: 0 }
      })
    };
    const analyticsEngine = {
      analyze: vi.fn().mockResolvedValue({
        analytics: {
          status: "estimated",
          estimatedApr: 12,
          estimatedPositionValueUsd: 1000,
          estimatedImpermanentLossUsd: 10,
          feeState: { estimatedUncollectedFeesUsd: 4 }
        }
      })
    };
    const activityLogs: Array<{ positionId: string; type: string }> = [];
    const activityLogger: WorkerActivityLogger = {
      log: vi.fn(async (entry) => {
        activityLogs.push({ positionId: entry.positionId, type: entry.type });
      })
    };
    const worker = new InProcessStrategyEvaluationWorker(strategyEngine as any, snapshotStore as any, {
      liveStateLoader: liveStateLoader as any,
      analyticsEngine: analyticsEngine as any,
      executionPolicy: new GuardedRebalanceExecutionPolicy({ allowExecution: false }),
      activityLogger,
      executor: null,
      loadPositions: async () => [buildPosition("p1"), buildPosition("p2")],
      loadPolicies: buildLoadPolicies(),
      logger: () => undefined
    });

    await worker.evaluateWallet({ wallet: WALLET });

    expect(activityLogs.some((item) => item.positionId === "p1" && item.type === "Error")).toBe(true);
    expect(activityLogs.some((item) => item.positionId === "p2" && item.type === "Snapshot refreshed")).toBe(true);
  });

  it("executes auto-compound when fees exceed threshold and rebalance is skipped", async () => {
    const strategyEngine = {
      evaluate: vi.fn().mockReturnValue(buildRecommendation({ shouldRebalance: false, netExpectedBenefitUsd: 1 }))
    };
    const snapshotStore = {
      saveSnapshot: vi.fn().mockResolvedValue(undefined),
      getRecentSnapshots: vi.fn().mockResolvedValue([])
    };
    const liveStateLoader = {
      enrich: vi.fn().mockResolvedValue({
        byPositionId: new Map([
          [
            "p1",
            {
              currentTick: 10,
              currentPrice: 3000,
              computedStatus: "IN_RANGE",
              token1PerToken0: 3000,
              sqrtPriceX96: "1",
              liquidity: "1000",
              snapshotUpdatedAt: new Date().toISOString(),
              stale: false,
              liveStateSource: "rpc"
            }
          ]
        ]),
        stats: { livePoolFetches: 1, fallbackCount: 0 }
      })
    };
    const analyticsEngine = {
      analyze: vi.fn().mockResolvedValue({
        analytics: {
          status: "estimated",
          estimatedApr: 12,
          estimatedPositionValueUsd: 1000,
          estimatedImpermanentLossUsd: 10,
          feeState: { estimatedUncollectedFeesUsd: 25 }
        }
      })
    };
    const activityLogs: Array<{ type: string; message: string }> = [];
    const activityLogger: WorkerActivityLogger = {
      log: vi.fn(async (entry) => {
        activityLogs.push({ type: entry.type, message: entry.message });
      })
    };
    const compoundCalls: Array<{ positionId: string }> = [];
    const autoCompoundExecutor: AutoCompoundExecutor = {
      execute: vi.fn(async (entry) => {
        compoundCalls.push({ positionId: entry.positionId });
        return { txHash: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd" as `0x${string}` };
      })
    };
    const worker = new InProcessStrategyEvaluationWorker(strategyEngine as any, snapshotStore as any, {
      liveStateLoader: liveStateLoader as any,
      analyticsEngine: analyticsEngine as any,
      executionPolicy: new GuardedRebalanceExecutionPolicy({ allowExecution: false }),
      autoCompoundExecutionPolicy: new GuardedAutoCompoundExecutionPolicy({ allowExecution: true, minimumFeesUsd: 10 }),
      activityLogger,
      executor: null,
      autoCompoundExecutor,
      loadPositions: async () => [buildPosition("p1")],
      loadPolicies: buildLoadPolicies(),
      logger: () => undefined
    });

    await worker.evaluateWallet({ wallet: WALLET });

    expect(compoundCalls).toHaveLength(1);
    expect(compoundCalls[0].positionId).toBe("p1");
    expect(activityLogs.some((item) => item.type === "Collect")).toBe(true);
  });
});
