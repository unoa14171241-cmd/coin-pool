import { Router } from "express";
import { allowedChainIds } from "../config/env";
import { getEthPriceUsd } from "../web3/price";
import { getRouteLatencySummary, recordRouteLatency } from "../services/observability/route-latency-observability";

const router = Router();

router.get("/market/eth-price", async (req, res) => {
  const startedAt = Date.now();
  const requestedChainId = Number(req.query.chainId ?? 42161);
  const chainId = allowedChainIds.includes(requestedChainId) ? requestedChainId : 42161;
  const price = await getEthPriceUsd(chainId);
  console.info(
    JSON.stringify({
      event: "market_eth_price_read",
      chainId,
      hasPrice: price != null,
      elapsedMs: Date.now() - startedAt,
      ...recordAndGetRouteLatency("GET /market/eth-price", Date.now() - startedAt)
    })
  );
  res.json({ chainId, symbol: "ETH/USD", price, source: "Chainlink" });
});

export default router;

function recordAndGetRouteLatency(routeKey: string, elapsedMs: number) {
  recordRouteLatency(routeKey, elapsedMs);
  return getRouteLatencySummary(routeKey);
}
