import { Router } from "express";
import { prisma } from "../db/prisma";
import { activityResponseSchema, createLogSchema } from "../schemas/position";
import { assertBodyWalletMatchesAuth, requireWalletSignature } from "../auth/middleware";
import { getRouteLatencySummary, recordRouteLatency } from "../services/observability/route-latency-observability";

const router = Router();

router.get("/activity/:wallet", async (req, res) => {
  const startedAt = Date.now();
  const wallet = req.params.wallet.toLowerCase();
  const logs = await prisma.activityLog.findMany({
    where: { wallet },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  const positionIds = Array.from(new Set(logs.map((item) => item.positionId).filter((value): value is string => Boolean(value))));
  const positionChainMap = new Map<string, number>();
  if (positionIds.length > 0) {
    const positions = await prisma.position.findMany({
      where: {
        wallet,
        positionId: { in: positionIds }
      },
      select: {
        positionId: true,
        chainId: true
      }
    });
    for (const row of positions) {
      positionChainMap.set(row.positionId, row.chainId);
    }
  }
  const now = Date.now();
  const payload = activityResponseSchema.parse(
    logs.map((item) => ({
      id: item.id,
      wallet: item.wallet as `0x${string}`,
      positionId: item.positionId,
      type: item.type,
      source: item.source,
      tx: item.tx,
      message: item.message,
      createdAt: item.createdAt.toISOString(),
      quality: inferActivityQuality(item.type, item.source, item.tx),
      generatedAt: item.createdAt.toISOString(),
      stale: now - item.createdAt.getTime() > 5 * 60_000,
      success: item.type !== "Error",
      error: item.type === "Error" ? item.message : null,
      chainId: item.positionId ? positionChainMap.get(item.positionId) ?? null : null
    }))
  );
  console.info(
    JSON.stringify({
      event: "activity_read",
      wallet,
      rows: payload.length,
      elapsedMs: Date.now() - startedAt,
      ...recordAndGetRouteLatency("GET /activity/:wallet", Date.now() - startedAt)
    })
  );
  res.json(payload);
});

router.post("/activity", requireWalletSignature, async (req, res) => {
  const startedAt = Date.now();
  if (!assertBodyWalletMatchesAuth(req, res)) return;
  const parsed = createLogSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const data = parsed.data;
  await prisma.activityLog.create({
    data: {
      wallet: data.wallet.toLowerCase(),
      positionId: data.positionId ?? null,
      type: data.type,
      source: data.source,
      tx: data.tx ?? null,
      message: data.message
    } as any
  });
  console.info(
    JSON.stringify({
      event: "activity_create",
      wallet: data.wallet.toLowerCase(),
      positionId: data.positionId ?? null,
      type: data.type,
      source: data.source,
      elapsedMs: Date.now() - startedAt,
      ...recordAndGetRouteLatency("POST /activity", Date.now() - startedAt)
    })
  );
  res.status(201).json({ ok: true });
});

export default router;

function inferActivityQuality(
  type: string,
  source: string,
  tx: string | null
): "exact" | "estimated" | "heuristic" | "placeholder" {
  if (type === "Error") return "placeholder";
  if (source === "worker") return "heuristic";
  if (tx && ["Mint", "Collect", "Rebalance", "Approve"].includes(type)) return "exact";
  if (type.includes("Snapshot") || type.includes("Position")) return "estimated";
  return "estimated";
}

function recordAndGetRouteLatency(routeKey: string, elapsedMs: number) {
  recordRouteLatency(routeKey, elapsedMs);
  return getRouteLatencySummary(routeKey);
}
