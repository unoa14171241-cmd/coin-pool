import { Router } from "express";
import { z } from "zod";
import { createChallenge } from "../auth/challenge-store";
import { getRouteLatencySummary, recordRouteLatency } from "../services/observability/route-latency-observability";

const walletSchema = z.string().startsWith("0x").length(42);
const actionSchema = z.string().trim().min(1).max(120).regex(/^[A-Z]+ [\/a-zA-Z0-9_-]+$/);
const chainIdSchema = z.coerce.number().int().positive().optional();

const router = Router();

router.get("/auth/challenge/:wallet", async (req, res) => {
  const startedAt = Date.now();
  const parsed = walletSchema.safeParse(req.params.wallet);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid wallet address" });
  }
  const parsedAction = actionSchema.safeParse(String(req.query.action ?? "POST /settings"));
  if (!parsedAction.success) {
    return res.status(400).json({ error: "Invalid action format" });
  }
  const parsedChainId = chainIdSchema.safeParse(req.query.chainId);
  if (!parsedChainId.success) {
    return res.status(400).json({ error: "Invalid chainId format" });
  }

  const wallet = parsed.data.toLowerCase();
  const action = parsedAction.data;
  const chainId = parsedChainId.data ?? null;
  const challenge = await createChallenge(wallet, action);
  const issuedAt = challenge.issuedAt;
  const expiresAt = new Date(challenge.expiresAt).toISOString();
  const message = `LP Manager Authentication
Wallet:${wallet}
Nonce:${challenge.nonce}
IssuedAt:${issuedAt}
Action:${action}
ChainId:${chainId ?? "none"}`;
  console.info(
    JSON.stringify({
      event: "auth_challenge_issued",
      wallet,
      action,
      chainId,
      elapsedMs: Date.now() - startedAt,
      ...recordAndGetRouteLatency("GET /auth/challenge/:wallet", Date.now() - startedAt)
    })
  );
  return res.json({ wallet, message, nonce: challenge.nonce, issuedAt, action, chainId, expiresAt });
});

export default router;

function recordAndGetRouteLatency(routeKey: string, elapsedMs: number) {
  recordRouteLatency(routeKey, elapsedMs);
  return getRouteLatencySummary(routeKey);
}
