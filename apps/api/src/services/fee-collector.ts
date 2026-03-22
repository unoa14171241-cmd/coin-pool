import { prisma } from "../db/prisma";

export type FeeCollectorResult = {
  positionId: string;
  token0FeesRaw: string;
  token1FeesRaw: string;
  estimatedFeesUsd: number;
  source: "onchain_state";
};

export async function collectPositionFeesPreview(positionId: string): Promise<FeeCollectorResult | null> {
  const rows = await prisma.$queryRaw<
    Array<{ positionId: string; tokensOwed0: string | null; tokensOwed1: string | null }>
  >`
    SELECT "positionId", "tokensOwed0", "tokensOwed1"
    FROM "OnchainPositionState"
    WHERE "positionId" = ${positionId}
    LIMIT 1;
  `;
  const row = rows[0];
  if (!row) return null;
  const token0 = Number(row.tokensOwed0 ?? "0");
  const token1 = Number(row.tokensOwed1 ?? "0");
  return {
    positionId: row.positionId,
    token0FeesRaw: row.tokensOwed0 ?? "0",
    token1FeesRaw: row.tokensOwed1 ?? "0",
    estimatedFeesUsd: token0 + token1,
    source: "onchain_state"
  };
}
