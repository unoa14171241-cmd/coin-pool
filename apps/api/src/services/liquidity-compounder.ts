import { prisma } from "../db/prisma";
import { env } from "../config/env";
import { collectPositionFeesPreview } from "./fee-collector";
import { quoteSwap } from "./token-swap-engine";

export type LiquidityCompoundResult = {
  positionId: string;
  compoundedUsd: number;
  estimatedGasUsd: number;
  compoundCount: number;
};

export async function compoundPositionFees(positionId: string): Promise<LiquidityCompoundResult | null> {
  const fees = await collectPositionFeesPreview(positionId);
  if (!fees || fees.estimatedFeesUsd <= 0) return null;
  const quote = quoteSwap({ amountInUsd: fees.estimatedFeesUsd, slippageBps: env.DEFAULT_SLIPPAGE_BPS });
  const compoundedUsd = Math.max(0, quote.amountOutUsd);

  const rows = await prisma.$queryRaw<Array<{ id: string; compoundCount: number; totalCompoundedFees: number | null }>>`
    SELECT "id", "compoundCount", "totalCompoundedFees"
    FROM "Position"
    WHERE "positionId" = ${positionId}
    LIMIT 1;
  `;
  const position = rows[0];
  if (!position) return null;
  const nextCompoundCount = (position.compoundCount ?? 0) + 1;
  const nextTotalFees = (position.totalCompoundedFees ?? 0) + compoundedUsd;
  await prisma.$executeRaw`
    UPDATE "Position"
    SET
      "compoundCount" = ${nextCompoundCount},
      "totalCompoundedFees" = ${nextTotalFees},
      "lastCompoundAt" = NOW()
    WHERE "id" = ${position.id};
  `;
  return {
    positionId,
    compoundedUsd,
    estimatedGasUsd: quote.estimatedGasUsd,
    compoundCount: nextCompoundCount
  };
}
